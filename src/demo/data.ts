// Demo dataset: three fictional companies, generated in the browser from a fixed seed.
//
// The real dashboard syncs invoices, credit notes and credit-note applications from an ERP into SQLite. Here
// the same three kinds of documents are generated with the same shape, so the calculation engine runs unchanged.
// Each month is generated from its own seed: a given month looks the same every day you open the demo, and new
// documents appear as their dates pass. Every name, address and amount is made up.

import { addDays, daysBetween, monthEnd, toDay, toIso, todayIso, weekday } from "./dates";

export type CompanyCode = "CAN" | "SYS" | "INC";
export type Currency = "CAD" | "USD";
export type Company = { code: CompanyCode; name: string; short: string; currency: Currency };

// Two companies in CAD, one in USD: USD and CAD are never added together anywhere in the app.
export const COMPANIES: Company[] = [
  { code: "CAN", name: "Halden Canada", short: "Canada", currency: "CAD" },
  { code: "SYS", name: "Halden Systems", short: "Systems", currency: "CAD" },
  { code: "INC", name: "Halden Inc.", short: "Inc.", currency: "USD" },
];
export const companyOf = (code: string) => COMPANIES.find((c) => c.code === code)!;

/** Breakdown of a document, in integer cents of the document's own currency. */
export type Amounts = { sub_total: number; discount: number; shipping: number; adjustment: number; tax: number; total: number };
export const beforeTax = (a: Amounts) => a.total - a.tax;

export type Invoice = {
  id: string;
  company: CompanyCode;
  number: string;
  date: string;
  status: "draft" | "sent" | "paid" | "overdue" | "partially_paid" | "void";
  customer: string;
  salesperson: string; // "" = no salesperson on the invoice
  currency: Currency; // the document's currency (can differ from the company's)
  exchange_rate: number; // to the company's currency
  amounts: Amounts;
  region: string | null; // "CA-QC", "US-TX", "W-ES"; null = no recognizable address
  region_from_billing: boolean; // no region on the shipping address: taken from the billing address
  balance: number; // still owed, tax included, cents of the document's currency
  due_date: string;
  partnership: string; // customer field
  sales_channel: string; // customer field
  sales_type: string; // invoice field
};

export type CreditNote = {
  id: string;
  company: CompanyCode;
  number: string;
  date: string;
  status: "open" | "closed" | "void";
  customer: string;
  salesperson: string;
  currency: Currency;
  exchange_rate: number;
  amounts: Amounts;
};

/** Part of a credit note applied to one invoice (tax included, credit note's currency). */
export type Application = { id: string; creditnote_id: string; invoice_id: string; invoice_number: string; date: string; amount: number };

export type Dataset = {
  today: string;
  invoices: Invoice[];
  creditNotes: CreditNote[];
  applications: Application[];
  fx: Map<string, number>; // business day → CAD per USD (synthetic)
};

// ------------------------------------------------------------------ people and customers

/** Name on the invoice → how the dashboard treats it. Everything else is a person (each name its own row). */
export const SET_ASIDE = "Accounting Office"; // entries by accounting: never under a salesperson
export const UNASSIGNED = "Unassigned";

const PEOPLE: Record<CompanyCode, [string, number][]> = {
  CAN: [["Sophie Tremblay", 24], ["Marc Bélanger", 18], ["Daniel Okafor", 14], ["Priya Raman", 12], ["Kevin MacLeod", 9], ["Laura Chen", 8], ["Partners Desk", 5]],
  SYS: [["Julie Fortin", 40], ["Daniel Okafor", 25], ["Laura Chen", 20]],
  INC: [["Jason Miller", 26], ["Ana Torres", 22], ["Ryan Brooks", 16], ["Megan Walsh", 14], ["Laura Chen", 10], ["Distribution South", 6]],
};

const CANADA: [string, number][] = [["CA-QC", 30], ["CA-ON", 28], ["CA-BC", 10], ["CA-AB", 9], ["CA-MB", 4], ["CA-SK", 3], ["CA-NS", 4], ["CA-NB", 3], ["CA-NL", 2], ["CA-PE", 1]];
const STATES: [string, number][] = [
  ["US-CA", 12], ["US-TX", 10], ["US-FL", 8], ["US-NY", 7], ["US-PA", 5], ["US-IL", 5], ["US-OH", 5], ["US-GA", 4], ["US-NC", 4],
  ["US-WA", 4], ["US-MI", 4], ["US-AZ", 3], ["US-CO", 3], ["US-MA", 3], ["US-NJ", 3], ["US-VA", 3], ["US-TN", 3], ["US-MN", 2],
  ["US-WI", 2], ["US-MO", 2], ["US-IN", 2], ["US-OR", 2], ["US-UT", 2], ["US-KY", 1], ["US-LA", 1], ["US-OK", 1], ["US-NV", 1],
  ["US-SC", 1], ["US-AL", 1], ["US-IA", 1], ["US-KS", 1], ["US-NE", 1], ["US-ME", 1], ["US-NH", 1], ["US-ID", 1],
];
// Canadian companies' US customers are mostly in border states.
const BORDER: [string, number][] = [["US-NY", 5], ["US-MI", 4], ["US-OH", 3], ["US-PA", 3], ["US-VT", 2], ["US-ME", 2], ["US-MN", 2], ["US-WA", 3], ["US-MA", 2], ["US-NH", 1]];
// Big accounts cluster where the market is: a customer's size is scaled up in these regions.
const PULL: Record<string, number> = { "CA-QC": 1.9, "CA-ON": 1.9, "CA-BC": 1.3, "CA-AB": 1.2, "US-CA": 1.6, "US-TX": 1.5, "US-FL": 1.3, "US-NY": 1.3, "US-IL": 1.2 };
const WORLD: [string, number][] = [
  ["W-MX", 6], ["W-GB", 5], ["W-DE", 5], ["W-FR", 4], ["W-ES", 4], ["W-NL", 4], ["W-AU", 4], ["W-IT", 3], ["W-JP", 3], ["W-BR", 3],
  ["W-SE", 2], ["W-NO", 2], ["W-DK", 2], ["W-BE", 2], ["W-CH", 2], ["W-AT", 1], ["W-PL", 2], ["W-IE", 2], ["W-PT", 1], ["W-AE", 2],
  ["W-SA", 2], ["W-IL", 1], ["W-KR", 2], ["W-IN", 2], ["W-NZ", 1], ["W-ZA", 1], ["W-CL", 2], ["W-CO", 2], ["W-PE", 1], ["W-CR", 1], ["W-PA", 1],
];

const PLACES = ["Riverside", "Northgate", "Summit Ridge", "Bayview", "Cedar Point", "Lakeshore", "Granite Falls", "Maple Grove",
  "Harbor Light", "Prairie Wind", "Silverline", "Redwood", "Aurora", "Pinecrest", "Westbrook", "Eastfield", "Bluewater",
  "Ironwood", "Highland", "Clearwater", "Stonebridge", "Oakridge", "Brightwater", "Falcon Crest", "Keystone", "Meridian",
  "Pioneer", "Sterling", "Trillium", "Willow Creek", "Copperfield", "Elmstead", "Foxhollow", "Glenmore", "Hawthorne",
  "Juniper", "Kingsway", "Larchmont", "Moraine", "Norwood", "Orchard Hill", "Parkview", "Quarry Bay", "Rosedale",
  "Sandpiper", "Thornbury", "Upland", "Vista", "Whitmore", "Yarrow", "Zephyr", "Ashgrove", "Birchwood", "Coldwater",
  "Driftwood", "Evergreen", "Fairhaven", "Greystone", "Hillcrest", "Inverness", "Jasper Lane", "Kestrel", "Lynwood",
  "Marigold", "Newhaven", "Oakmont", "Peregrine", "Quillon", "Ravenwood", "Shoreline", "Tamarack", "Ulmus", "Valemont"];
const KINDS: Record<CompanyCode, string[]> = {
  CAN: ["Fleet Services", "Industrial Supply", "Equipment Ltd.", "Logistics", "Fabrication", "Transit Authority", "Utilities", "Rentals"],
  SYS: ["Automation", "Controls Ltd.", "Machine Works", "Robotics", "Packaging", "Systems Integration"],
  INC: ["Fleet Solutions", "Industrial Group", "Equipment Co.", "Logistics Inc.", "Supply Corp.", "Machinery Co.", "Services Group", "Municipal Fleet"],
};
const PARTNERSHIP = ["OEM", "Distributor", "End user", "Government", ""];
const CHANNEL = ["Direct", "Dealer", "Online store", "Tender", ""];
const SALES_TYPE = ["New equipment", "Replacement parts", "Service", "Custom project", ""];

// Sales tax by province/state, in % (approximate, demo only). Exports and most US sales: none.
const TAX: Record<string, number> = {
  "CA-QC": 14.975, "CA-ON": 13, "CA-NB": 15, "CA-NS": 15, "CA-NL": 15, "CA-PE": 15, "CA-BC": 12, "CA-MB": 12, "CA-SK": 11, "CA-AB": 5,
};

type Customer = {
  name: string;
  company: CompanyCode;
  owner: string;
  region: string | null;
  fromBilling: boolean;
  weight: number;
  scale: number;
  partnership: string;
  channel: string;
  terms: number;
};

// ------------------------------------------------------------------ random numbers (seeded)

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

class Rng {
  private r: () => number;
  constructor(...seed: (number | string)[]) {
    this.r = mulberry32(hash("halden-demo", ...seed));
  }
  next() { return this.r(); }
  int(lo: number, hi: number) { return lo + Math.floor(this.r() * (hi - lo + 1)); }
  chance(p: number) { return this.r() < p; }
  pick<T>(xs: T[]): T { return xs[Math.floor(this.r() * xs.length)]; }
  weighted<T>(xs: [T, number][]): T {
    const total = xs.reduce((s, [, w]) => s + w, 0);
    let u = this.r() * total;
    for (const [x, w] of xs) if ((u -= w) < 0) return x;
    return xs[xs.length - 1][0];
  }
  normal() {
    const u = Math.max(1e-9, this.r());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.r());
  }
  logNormal(median: number, sigma: number) { return median * Math.exp(sigma * this.normal()); }
}

// ------------------------------------------------------------------ exchange rate (synthetic)

/** CAD per USD on a day: a smooth made-up curve around 1.37, not real market data. */
export function demoRate(day: number): number {
  const wobble = ((hash("fx", day) % 1000) / 1000 - 0.5) * 0.006;
  return Math.round((1.372 + 0.022 * Math.sin(day / 75) + 0.01 * Math.sin(day / 23) + wobble) * 10000) / 10000;
}

// ------------------------------------------------------------------ customers

function customers(): Customer[] {
  const rng = new Rng("customers");
  const used = new Set<string>();
  const out: Customer[] = [];
  const counts: Record<CompanyCode, number> = { CAN: 82, SYS: 36, INC: 100 };
  for (const company of ["CAN", "SYS", "INC"] as CompanyCode[]) {
    for (let i = 0; i < counts[company]; i++) {
      let name = "";
      do name = `${rng.pick(PLACES)} ${rng.pick(KINDS[company])}`; while (used.has(name));
      used.add(name);
      const where = rng.next();
      const region = company === "INC"
        ? (where < 0.78 ? rng.weighted(STATES) : where < 0.95 ? rng.weighted(WORLD) : rng.weighted(CANADA))
        : company === "SYS"
          ? (where < 0.86 ? rng.weighted(CANADA) : where < 0.9 ? rng.weighted(BORDER) : rng.weighted(WORLD))
          : (where < 0.8 ? rng.weighted(CANADA) : where < 0.85 ? rng.weighted(BORDER) : rng.weighted(WORLD));
      out.push({
        name,
        company,
        owner: rng.weighted(PEOPLE[company]),
        region: rng.chance(0.006) ? null : region,
        fromBilling: rng.chance(0.04),
        weight: (Math.pow(rng.next(), 2.2) * 10 + 0.3) * (PULL[region] ?? 1), // a few big accounts, many small ones
        scale: 0.6 + rng.next() * 1.2,
        partnership: rng.weighted(PARTNERSHIP.map((p, j) => [p, j === 4 ? 1 : 4] as [string, number])),
        channel: rng.weighted(CHANNEL.map((c, j) => [c, j === 4 ? 1 : j === 0 ? 8 : 3] as [string, number])),
        terms: rng.weighted([[30, 8], [45, 2], [60, 1]]),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ documents

// Fixed first month: documents are numbered from it, so a past month never changes as days pass.
const EPOCH = { year: 2024, month: 7 }; // July 2024
const VOLUME: Record<CompanyCode, number> = { CAN: 62, SYS: 18, INC: 48 }; // invoices per month, before season/growth
const MEDIAN: Record<CompanyCode, number> = { CAN: 24000, SYS: 17000, INC: 31000 }; // invoice size, company currency
const SEASON = [0.78, 0.92, 1.08, 1.1, 1.12, 1.04, 0.84, 0.9, 1.08, 1.14, 1.1, 0.86]; // Jan … Dec
const PREFIX: Record<CompanyCode, string> = { CAN: "INV-C", SYS: "INV-S", INC: "INV-U" };
const CN_PREFIX: Record<CompanyCode, string> = { CAN: "CN-C", SYS: "CN-S", INC: "CN-U" };

const cents = (dollars: number) => Math.round(dollars * 100);

function salespersonFor(rng: Rng, c: Customer): string {
  const u = rng.next();
  if (u < 0.03) return ""; // no salesperson on the invoice
  if (u < 0.045) return SET_ASIDE; // entered by accounting
  if (u < 0.1) return rng.weighted(PEOPLE[c.company]);
  return c.owner;
}

function taxRate(rng: Rng, region: string | null, company: CompanyCode): number {
  if (!region || region.startsWith("W-")) return 0;
  if (region.startsWith("CA-")) return TAX[region] ?? 5;
  // US: most customers resell or are exempt; some pay state sales tax.
  return company === "INC" && rng.chance(0.18) ? rng.pick([4, 6, 6.25, 7, 8.25]) : 0;
}

export function generate(today: string = todayIso()): Dataset {
  const all = customers();
  const byCompany = (code: CompanyCode) => all.filter((c) => c.company === code);
  const invoices: Invoice[] = [];
  const creditNotes: CreditNote[] = [];
  const applications: Application[] = [];
  const counters: Record<string, number> = { CAN: 10840, SYS: 2310, INC: 6120, "cn-CAN": 920, "cn-SYS": 180, "cn-INC": 610 };
  const firstMonth = new Date(Date.UTC(EPOCH.year, EPOCH.month - 1, 1));
  const monthsToToday = (Number(today.slice(0, 4)) - EPOCH.year) * 12 + Number(today.slice(5, 7)) - EPOCH.month;
  // Random draw per invoice for its payment, kept so the status only depends on "today".
  const payDraw = new Map<string, [number, number]>();

  for (let m = 0; m <= monthsToToday; m++) {
    const first = toIso(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + m, 1) / 86400000);
    const last = monthEnd(first);
    const month = Number(first.slice(5, 7)) - 1;
    const years = Math.min(m / 12, 4); // growth since the start of the data
    for (const company of ["CAN", "SYS", "INC"] as CompanyCode[]) {
      const rng = new Rng(company, first);
      const list = byCompany(company);
      const weights = list.map((c) => [c, c.weight] as [Customer, number]);
      const n = Math.round(VOLUME[company] * SEASON[month] * (1 + 0.11 * years) * (0.88 + rng.next() * 0.24));
      const days: string[] = [];
      for (let d = toDay(first); d <= toDay(last); d++) if (weekday(toIso(d)) % 6 !== 0) days.push(toIso(d));
      const docs: Invoice[] = [];
      for (let i = 0; i < n; i++) {
        const c = rng.weighted(weights);
        const date = rng.pick(days);
        let size = rng.logNormal(MEDIAN[company], 0.85) * c.scale;
        if (rng.chance(0.025)) size *= rng.int(6, 14); // a large project now and then
        // A Canadian company invoicing a US customer bills in USD, converted at the day's rate.
        const docCurrency: Currency = company !== "INC" && c.region?.startsWith("US-") ? "USD" : companyOf(company).currency;
        const rate = docCurrency === companyOf(company).currency ? 1 : demoRate(toDay(date));
        const docSize = size / rate;
        const sub = cents(Math.round(docSize / 50) * 50);
        const discount = rng.chance(0.15) ? cents(docSize * rng.pick([0.05, 0.08, 0.1])) : 0;
        const shipping = rng.chance(0.55) ? cents(rng.int(350, 4200)) : 0;
        const adjustment = rng.chance(0.02) ? cents(rng.int(-400, 400)) : 0;
        const tax = Math.round((sub - discount + shipping) * taxRate(rng, c.region, company) / 100);
        const amounts = { sub_total: sub, discount, shipping, adjustment, tax, total: sub - discount + shipping + adjustment + tax };
        const status: Invoice["status"] = rng.chance(0.012) ? "void" : daysBetween(date, today) < 10 && rng.chance(0.03) ? "draft" : "sent";
        docs.push({
          id: "", company, number: "", date, status, customer: c.name, salesperson: salespersonFor(rng, c),
          currency: docCurrency, exchange_rate: rate, amounts, region: c.region, region_from_billing: !!c.region && c.fromBilling,
          balance: amounts.total, due_date: addDays(date, c.terms), partnership: c.partnership, sales_channel: c.channel,
          sales_type: rng.weighted(SALES_TYPE.map((t, j) => [t, j === 4 ? 1 : j === 1 ? 6 : 3] as [string, number])),
        });
      }
      docs.sort((a, b) => a.date.localeCompare(b.date));
      for (const inv of docs) {
        const k = ++counters[company];
        inv.id = `${company}-i${k}`;
        inv.number = `${PREFIX[company]}-${String(k).padStart(5, "0")}`;
        payDraw.set(inv.id, [rng.next(), rng.next()]);
        if (inv.date <= today) invoices.push(inv);
      }

      // Credit notes: returns and price corrections on some invoices, plus a few goodwill credits.
      const cnRng = new Rng("cn", company, first);
      const toCredit = docs.filter((d) => d.status !== "draft");
      const goodwill = cnRng.int(0, 2);
      const events: { inv: Invoice | null; date: string; frac: number }[] = [];
      for (const inv of toCredit) {
        if (!cnRng.chance(company === "SYS" ? 0.04 : 0.065)) continue;
        const frac = cnRng.chance(0.3) ? 1 : 0.05 + cnRng.next() * 0.45;
        events.push({ inv, date: addDays(inv.date, cnRng.int(3, 45)), frac });
      }
      for (let g = 0; g < goodwill; g++) events.push({ inv: null, date: cnRng.pick(days), frac: 0 });
      events.sort((a, b) => a.date.localeCompare(b.date));
      for (const e of events) {
        const k = ++counters[`cn-${company}`];
        const id = `${company}-c${k}`;
        const c = e.inv ? null : cnRng.weighted(weights);
        let amounts: Amounts;
        let currency: Currency;
        let rate: number;
        if (e.inv) {
          const a = e.inv.amounts;
          const sub = Math.round(beforeTax(a) * e.frac);
          const tax = Math.round(a.tax * e.frac);
          amounts = { sub_total: sub, discount: 0, shipping: 0, adjustment: 0, tax, total: sub + tax };
          currency = e.inv.currency;
          rate = e.inv.currency === companyOf(company).currency ? 1 : demoRate(toDay(e.date));
        } else {
          const sub = cents(cnRng.int(4, 60) * 100);
          amounts = { sub_total: sub, discount: 0, shipping: 0, adjustment: 0, tax: 0, total: sub };
          currency = companyOf(company).currency;
          rate = 1;
        }
        const u = cnRng.next();
        const owner = e.inv ? e.inv.salesperson : c!.owner;
        const salesperson = u < 0.82 ? owner : u < 0.92 ? SET_ASIDE : cnRng.weighted(PEOPLE[company]);
        const voided = cnRng.chance(0.02);
        const applied = !!e.inv && e.inv.status !== "void" && !voided && cnRng.chance(0.8);
        const appliedOn = applied ? addDays(e.date, cnRng.int(0, 7)) : "";
        if (e.date > today) continue;
        creditNotes.push({
          id, company, number: `${CN_PREFIX[company]}-${String(k).padStart(4, "0")}`, date: e.date,
          status: voided ? "void" : applied && appliedOn <= today ? "closed" : "open",
          customer: e.inv ? e.inv.customer : c!.name, salesperson, currency, exchange_rate: rate, amounts,
        });
        if (applied && appliedOn <= today) {
          applications.push({ id: `${id}-a`, creditnote_id: id, invoice_id: e.inv!.id, invoice_number: e.inv!.number,
            date: appliedOn, amount: amounts.total });
        }
      }
    }
  }

  // Payments as of today, by days past the due date: most customers pay around the due date, a few run late.
  const credited = new Map<string, number>();
  for (const a of applications) credited.set(a.invoice_id, (credited.get(a.invoice_id) ?? 0) + a.amount);
  for (const inv of invoices) {
    if (inv.status === "void" || inv.status === "draft") {
      inv.balance = 0;
      continue;
    }
    const [u, v] = payDraw.get(inv.id)!;
    const late = daysBetween(inv.due_date, today);
    const pPaid = late < -20 ? 0.08 : late < -7 ? 0.2 : late < 0 ? 0.4 : late < 15 ? 0.85 : late < 30 ? 0.93 : late < 60 ? 0.965
      : late < 90 ? 0.98 : late < 365 ? 0.996 : 0.999;
    let balance = u < pPaid ? 0 : v < 0.1 ? Math.round(inv.amounts.total * 0.4) : inv.amounts.total;
    const partial = balance > 0 && balance < inv.amounts.total;
    balance = Math.max(0, balance - (credited.get(inv.id) ?? 0));
    inv.balance = balance;
    inv.status = balance === 0 ? "paid" : partial ? "partially_paid" : inv.due_date < today ? "overdue" : "sent";
  }

  const fx = new Map<string, number>();
  for (let d = toDay(toIso(firstMonth.getTime() / 86400000)); d <= toDay(today); d++) {
    if (weekday(toIso(d)) % 6 !== 0) fx.set(toIso(d), demoRate(d));
  }
  return { today, invoices, creditNotes, applications, fx };
}
