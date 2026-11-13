// Sales and credit notes per salesperson and company for a period. Pure: no I/O.
// (Port of the production app's Python engine; same rules, same structure.)
//
// Rules:
// - Sales = invoices dated in the period, under the invoice's salesperson. Drafts and void documents never count.
// - Credit notes follow the ERP's own "credit notes by salesperson" rule: each credit note counts whole under ITS
//   OWN salesperson, in ITS OWN date's period and company, applied or not. Where it was applied only matters for
//   the map: applied parts take the region of their invoice; the rest has no address (not on the map, and out
//   with a region filter).
// - Before taxes (default) = total − tax, for invoices and credit notes; applied parts are reduced in
//   proportion (credit note total − tax) ÷ total.
// - Every amount is in its company's currency (Canada, Systems: CAD; Inc.: USD), converted with the document's
//   own exchange rate. No outside rate and no total across currencies.
// - "Accounting Office" (set aside): never under a salesperson; in company totals and the map only when
//   countSetAside is on.
// Every amount added to a line is also kept as an Entry, so the drill-down shows exactly what was counted.

import { beforeTax, COMPANIES, CompanyCode, CreditNote, Currency, Dataset, Invoice, SET_ASIDE, UNASSIGNED, companyOf } from "./data";
import { UNKNOWN_REGION } from "./regions";

export type Kind = "person" | "set_aside" | "unassigned";
export type Salesperson = { name: string; kind: Kind };

/** Name on the document → row. Every name is its own row; nothing is merged. */
export function resolve(name: string): Salesperson {
  const n = name.trim();
  if (!n) return { name: UNASSIGNED, kind: "unassigned" };
  return { name: n, kind: n === SET_ASIDE ? "set_aside" : "person" };
}

export type Options = {
  start: string;
  end: string; // inclusive
  includeTax: boolean;
  countSetAside: boolean;
  company: CompanyCode | null; // null = all three
  region: string | null; // null = all; a code ("CA-QC") or UNKNOWN_REGION (map click)
};

export type Entry = { kind: "sale" | "credit"; amount: number; invoice?: Invoice; creditNote?: CreditNote };

export class Line {
  sales = 0;
  credits = 0;
  entries: Entry[] = [];
  constructor(public salesperson: Salesperson, public company: string, public currency: Currency) {}
  get net() { return this.sales - this.credits; }
  /** Credit notes of the period as % of the sales of the period; null without sales. */
  get creditPct() { return this.sales ? (this.credits / this.sales) * 100 : null; }
  record(e: Entry) {
    if (e.kind === "sale") this.sales += e.amount;
    else this.credits += e.amount;
    this.entries.push(e);
  }
  absorb(other: Line) {
    this.sales += other.sales;
    this.credits += other.credits;
  }
}

export type ByCurrency = Partial<Record<Currency, number>>;

export type Report = {
  options: Options;
  lines: Line[]; // one per (salesperson, company), set-aside ones included
  companyTotals: Map<string, Line>; // per company; set-aside included only if countSetAside
  regions: Map<string | null, ByCurrency>; // region → currency → net (unapplied credit notes excluded)
  regionSales: Map<string | null, ByCurrency>; // same, sales only (the map's colours and %)
};

const counts = (status: string) => status !== "draft" && status !== "void";

export function compute(ds: Dataset, o: Options): Report {
  const invoicesById = new Map(ds.invoices.map((i) => [i.id, i]));
  const lines = new Map<string, Line>();
  const regions = new Map<string | null, ByCurrency>();
  const regionSales = new Map<string | null, ByCurrency>();

  const inScope = (company: string, day: string) => o.start <= day && day <= o.end && (o.company === null || o.company === company);
  // With a region filter, only invoices shipped there and the parts of credit notes applied to them count.
  const inRegion = (inv: Invoice) => o.region === null || (inv.region ?? UNKNOWN_REGION) === o.region;
  const lineFor = (name: string, company: CompanyCode) => {
    const person = resolve(name);
    const key = `${person.name}|${company}`;
    if (!lines.has(key)) lines.set(key, new Line(person, company, companyOf(company).currency));
    return lines.get(key)!;
  };
  // Converted to the company's currency and rounded to the cent per document, so every total is a sum of exact cents.
  const base = (cents: number, rate: number) => Math.round(cents * rate) / 100;
  const add = (m: Map<string | null, ByCurrency>, region: string | null, cur: Currency, v: number) => {
    const by = m.get(region) ?? {};
    by[cur] = (by[cur] ?? 0) + v;
    m.set(region, by);
  };
  const onMap = (line: Line, amount: number, region: string | null, sale = false) => {
    if (o.countSetAside || line.salesperson.kind !== "set_aside") {
      add(regions, region, line.currency, amount);
      if (sale) add(regionSales, region, line.currency, amount);
    }
  };

  // Sales
  for (const inv of ds.invoices) {
    if (counts(inv.status) && inScope(inv.company, inv.date) && inRegion(inv)) {
      const amount = base(o.includeTax ? inv.amounts.total : beforeTax(inv.amounts), inv.exchange_rate);
      const line = lineFor(inv.salesperson, inv.company);
      line.record({ kind: "sale", amount, invoice: inv });
      onMap(line, amount, inv.region, true);
    }
  }

  // Credit notes: whole, under their own salesperson, date and company.
  const appsByCn = new Map<string, typeof ds.applications>();
  for (const a of ds.applications) appsByCn.set(a.creditnote_id, [...(appsByCn.get(a.creditnote_id) ?? []), a]);
  for (const cn of ds.creditNotes) {
    if (!counts(cn.status) || cn.amounts.total === 0 || !inScope(cn.company, cn.date)) continue;
    const ratio = o.includeTax ? 1 : beforeTax(cn.amounts) / cn.amounts.total;
    const applied = (appsByCn.get(cn.id) ?? [])
      .map((a) => [invoicesById.get(a.invoice_id), a.amount] as const)
      .filter(([inv]) => inv && counts(inv.status)) as [Invoice, number][];
    let counted = cn.amounts.total;
    if (o.region !== null) {
      counted = applied.filter(([inv]) => inRegion(inv)).reduce((s, [, c]) => s + c, 0);
      if (!counted) continue;
    }
    const line = lineFor(cn.salesperson, cn.company);
    line.record({ kind: "credit", amount: base(counted * ratio, cn.exchange_rate), creditNote: cn });
    for (const [inv, c] of applied) if (inRegion(inv)) onMap(line, -base(c * ratio, cn.exchange_rate), inv.region);
  }

  // Totals per company
  const companyTotals = new Map<string, Line>();
  for (const line of lines.values()) {
    if (line.salesperson.kind === "set_aside" && !o.countSetAside) continue;
    if (!companyTotals.has(line.company)) {
      companyTotals.set(line.company, new Line({ name: line.company, kind: "person" }, line.company, line.currency));
    }
    companyTotals.get(line.company)!.absorb(line);
  }

  const sorted = [...lines.values()].sort((a, b) =>
    a.salesperson.name.localeCompare(b.salesperson.name, "en", { sensitivity: "base" }) || a.company.localeCompare(b.company));
  return { options: o, lines: sorted, companyTotals, regions, regionSales };
}

export const salespersonLines = (r: Report) => r.lines.filter((l) => l.salesperson.kind !== "set_aside");
export const setAsideLines = (r: Report) => r.lines.filter((l) => l.salesperson.kind === "set_aside");

/** Companies in the order the screen shows them (CAD first). */
export const companiesInScope = (company: CompanyCode | null) => COMPANIES.filter((c) => company === null || c.code === company);
