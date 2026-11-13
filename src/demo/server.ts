// Stand-in for the production app's HTTP API: the same routes, as functions that return the same JSON shapes,
// computed in the browser from the demo dataset. The React pages call these through src/api.ts exactly as they
// called /api/report, /api/kpi, … on the server.

import type { CreditNoteDetail, Documents, Filters, InvoiceDetail, Kpi, PersonRow, Report as ReportJson, Totals } from "../api";
import { COMPANIES, CompanyCode, Currency, Dataset, generate, companyOf } from "./data";
import { addDays, daysBetween, monthEnd, monthStart } from "./dates";
import { compute, Line, Options, Report, resolve, salespersonLines, setAsideLines } from "./engine";
import { label, UNKNOWN_REGION } from "./regions";

let cached: Dataset | null = null;
/** Generated once per page load (a fraction of a second). */
export function dataset(): Dataset {
  return (cached ??= generate());
}

/** Tests: run on a dataset generated for a fixed day. */
export function useDataset(ds: Dataset): void {
  cached = ds;
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export const PERIOD_DAYS: Record<string, number> = { "30": 30, "90": 90, "365": 365 };

/** Rolling windows end today and include it: "30" = today and the 29 days before. */
export function periodBounds(f: Pick<Filters, "period" | "start" | "end">, today: string): [string, string] {
  const days = PERIOD_DAYS[f.period];
  if (days) return [addDays(today, -(days - 1)), today];
  if (f.start && f.end && f.start <= f.end) return [f.start, f.end];
  throw new Error("Choose a start date and an end date (in order).");
}

export function options(f: Filters): Options {
  const [start, end] = periodBounds(f, dataset().today);
  return { start, end, includeTax: f.tax, countSetAside: f.setAside, company: f.company || null, region: f.region || null };
}

export function engineReport(f: Filters | Options): Report {
  return compute(dataset(), "period" in f ? options(f) : f);
}

function lineJson(l: Line) {
  const pct = l.creditPct;
  return { company: l.company, currency: l.currency, sales: round(l.sales), credits: round(l.credits), net: round(l.net),
    credit_pct: pct === null ? null : round(pct) };
}

const withoutCompany = (l: Line): Totals => {
  const { company: _, ...rest } = lineJson(l);
  return rest;
};

/** One row per salesperson, one sub-row per company, and a total per currency (CAD companies add up; USD apart). */
function personRows(lines: Line[]): PersonRow[] {
  const byName = new Map<string, Line[]>();
  for (const l of lines) byName.set(l.salesperson.name, [...(byName.get(l.salesperson.name) ?? []), l]);
  const rows: PersonRow[] = [];
  for (const [name, ls] of byName) {
    const perCurrency = new Map<string, Line>();
    for (const l of ls) {
      if (!perCurrency.has(l.currency)) perCurrency.set(l.currency, new Line(l.salesperson, "", l.currency));
      perCurrency.get(l.currency)!.absorb(l);
    }
    rows.push({ name, kind: ls[0].salesperson.kind, former: false, totals: [...perCurrency.values()].map(withoutCompany),
      companies: ls.map(lineJson) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

function currencyTotals(r: Report): Totals[] {
  const per = new Map<string, Line>();
  for (const c of COMPANIES) {
    const t = r.companyTotals.get(c.code);
    if (!t) continue;
    if (!per.has(t.currency)) per.set(t.currency, new Line(t.salesperson, "", t.currency));
    per.get(t.currency)!.absorb(t);
  }
  return [...per.values()].map(withoutCompany);
}

/** Average CAD per USD over the period's business days (the latest before it when it has none). */
export function averageRate(start: string, end: string) {
  const fx = dataset().fx;
  let inside = [...fx.keys()].filter((d) => start <= d && d <= end).sort();
  if (!inside.length) {
    const before = [...fx.keys()].filter((d) => d < start).sort();
    if (!before.length) return null;
    inside = [before[before.length - 1]];
  }
  const rate = inside.reduce((s, d) => s + fx.get(d)!, 0) / inside.length;
  return { rate, first: inside[0], last: inside[inside.length - 1], days: inside.length };
}

/** The map: net and sales per region and currency, and each region's share of total sales. USD and CAD sales go
 * on one scale ONLY for that share, at the period's average rate; the share is then approximate (said on screen). */
function mapRegions(r: Report, o: Options) {
  const currencies = new Set<string>();
  for (const by of r.regionSales.values()) for (const [cur, v] of Object.entries(by)) if (v) currencies.add(cur);
  const avg = currencies.size > 1 ? averageRate(o.start, o.end) : null;
  const toCad: Record<string, number | null> = { CAD: 1, USD: avg ? avg.rate : currencies.size > 1 ? null : 1 };
  const comparable = (by: Partial<Record<Currency, number>>) => {
    let s = 0;
    for (const [cur, v] of Object.entries(by)) {
      if (!v) continue;
      if (toCad[cur] == null) return null;
      s += v * toCad[cur]!;
    }
    return s;
  };
  let total = 0;
  for (const by of r.regionSales.values()) total += comparable(by) ?? 0;
  const codes = new Set([...r.regions.keys(), ...r.regionSales.keys()]);
  const rows = [...codes].map((code) => {
    const sales = r.regionSales.get(code) ?? {};
    const share = comparable(sales);
    const money = (by: Partial<Record<Currency, number>>) => Object.fromEntries(Object.entries(by).map(([k, v]) => [k, round(v!)]));
    return { code: code ?? UNKNOWN_REGION, label: label(code), net: money(r.regions.get(code) ?? {}), sales: money(sales),
      share_pct: share === null || !total ? null : round((share / total) * 100) };
  });
  return {
    regions: rows.sort((a, b) => a.label.localeCompare(b.label)),
    fx: avg && { source: "synthetic demo rate", usd_cad: Math.round(avg.rate * 10000) / 10000, first: avg.first, last: avg.last, days: avg.days },
  };
}

/** 30 and 90 days: each company's net over the same number of days just before, same filters. */
function comparison(f: Filters, o: Options, r: Report): ReportJson["comparison"] {
  if (f.period !== "30" && f.period !== "90") return null;
  const days = daysBetween(o.start, o.end) + 1;
  const before: Options = { ...o, start: addDays(o.start, -days), end: addDays(o.start, -1) };
  const prev = engineReport(before).companyTotals;
  const companies = COMPANIES.filter((c) => o.company === null || c.code === o.company).map((c) => {
    const now = r.companyTotals.get(c.code)?.net ?? 0;
    const then = prev.get(c.code)?.net ?? 0;
    return { company: c.code, net: round(then), net_change_pct: then === 0 ? null : round(((now - then) / Math.abs(then)) * 100) };
  });
  return { period: { start: before.start, end: before.end }, companies };
}

export function dataAsOf(): string {
  return `${dataset().today}T07:00:00`;
}

export function report(f: Filters): ReportJson {
  const o = options(f);
  const r = engineReport(o);
  return {
    period: { start: o.start, end: o.end },
    filters: { company: o.company, region: o.region, tax: o.includeTax, set_aside: o.countSetAside },
    data_as_of: dataAsOf(),
    salespeople: personRows(salespersonLines(r)),
    set_aside: personRows(setAsideLines(r)),
    companies: COMPANIES.filter((c) => r.companyTotals.has(c.code)).map((c) => lineJson(r.companyTotals.get(c.code)!)),
    currency_totals: currencyTotals(r),
    company_info: COMPANIES.filter((c) => o.company === null || c.code === o.company)
      .map((c) => ({ code: c.code, name: c.name, currency: c.currency })),
    ...mapRegions(r, o),
    unrecognized: [],
    comparison: comparison(f, o, r),
  };
}

/** What was counted for one salesperson: their invoices and credit notes of the period, each credit note with
 * the invoices it was applied to (which may be someone else's, or older). */
export function documents(name: string, f: Filters): Documents {
  const ds = dataset();
  const byId = new Map(ds.invoices.map((i) => [i.id, i]));
  const lines = engineReport(f).lines.filter((l) => l.salesperson.name === name);
  const invoices: Documents["invoices"] = [];
  const notes: Documents["credit_notes"] = [];
  for (const line of lines) {
    for (const e of line.entries) {
      if (e.kind === "sale") {
        const inv = e.invoice!;
        invoices.push({ id: inv.id, number: inv.number, date: inv.date, company: inv.company, currency: companyOf(inv.company).currency,
          document_currency: inv.currency, status: inv.status, customer: inv.customer, region: label(inv.region),
          region_from_billing: inv.region_from_billing, sales: round(e.amount) });
      } else {
        const cn = e.creditNote!;
        const applied = ds.applications.filter((a) => a.creditnote_id === cn.id).map((a) => {
          const inv = byId.get(a.invoice_id);
          return { id: a.invoice_id, number: inv?.number ?? a.invoice_number, date: inv?.date ?? null, salesperson: inv?.salesperson || null };
        });
        notes.push({ id: cn.id, number: cn.number, date: cn.date, company: cn.company, currency: companyOf(cn.company).currency,
          customer: cn.customer, status: cn.status, counted: round(e.amount), applied_to: applied });
      }
    }
  }
  const newest = (a: { date: string; number: string }, b: { date: string; number: string }) =>
    b.date.localeCompare(a.date) || b.number.localeCompare(a.number);
  return { name, invoices: invoices.sort(newest), credit_notes: notes.sort(newest) };
}

export function invoice(id: string): InvoiceDetail {
  const ds = dataset();
  const inv = ds.invoices.find((i) => i.id === id);
  if (!inv) throw new Error("Invoice not found");
  const notes = ds.applications.filter((a) => a.invoice_id === id).flatMap((a) => {
    const cn = ds.creditNotes.find((c) => c.id === a.creditnote_id);
    return cn ? [{ id: cn.id, number: cn.number, date: cn.date, status: cn.status, applied: a.amount / 100, applied_on: a.date, currency: cn.currency }] : [];
  });
  const a = inv.amounts;
  return { id: inv.id, number: inv.number, date: inv.date, company: inv.company, status: inv.status, customer: inv.customer,
    salesperson: inv.salesperson || null, currency: inv.currency, region: label(inv.region), region_from_billing: inv.region_from_billing,
    sub_total: a.sub_total / 100, discount: a.discount / 100, shipping: a.shipping / 100, adjustment: a.adjustment / 100,
    tax: a.tax / 100, total: a.total / 100, credit_notes: notes.sort((x, y) => x.date.localeCompare(y.date)) };
}

export function creditNote(id: string): CreditNoteDetail {
  const ds = dataset();
  const cn = ds.creditNotes.find((c) => c.id === id);
  if (!cn) throw new Error("Credit note not found");
  let appliedCents = 0;
  const invoices = ds.applications.filter((a) => a.creditnote_id === id).map((a) => {
    appliedCents += a.amount;
    const inv = ds.invoices.find((i) => i.id === a.invoice_id);
    return { id: a.invoice_id, number: inv?.number ?? a.invoice_number, date: inv?.date ?? null, salesperson: inv?.salesperson || null,
      status: inv?.status ?? "missing", applied: a.amount / 100, applied_on: a.date };
  });
  const a = cn.amounts;
  return { id: cn.id, number: cn.number, date: cn.date, company: cn.company, status: cn.status, customer: cn.customer,
    salesperson: cn.salesperson || null, currency: cn.currency, sub_total: a.sub_total / 100, tax: a.tax / 100, total: a.total / 100,
    unapplied: (a.total - appliedCents) / 100, invoices: invoices.sort((x, y) => (x.date ?? "").localeCompare(y.date ?? "")) };
}

// ------------------------------------------------------------------ KPI page

const AGING: [string, string, number | null][] = [
  ["not_due", "Not yet due", 0], ["1_30", "1–30 days", 30], ["31_60", "31–60 days", 60], ["61_90", "61–90 days", 90], ["90_plus", "Over 90 days", null],
];

/** The 12 calendar months ending with today's (in progress, so it ends today), oldest first. */
export function lastMonths(today: string, n = 12): [string, string][] {
  const out: [string, string][] = [];
  let first = monthStart(today);
  for (let i = 0; i < n; i++) {
    const end = monthEnd(first);
    out.push([first, end < today ? end : today]);
    first = monthStart(addDays(first, -1));
  }
  return out.reverse();
}

/** Monthly sales and credit-note rate over the last 12 months, unpaid invoices as of today (period ignored). */
export function kpi(f: Filters): Kpi {
  const ds = dataset();
  const today = ds.today;
  const base = options({ ...f, region: "" });
  const scope = COMPANIES.filter((c) => base.company === null || c.code === base.company);
  const months = lastMonths(today);
  const monthly = new Map<string, { sales: number; credits: number }[]>(scope.map((c) => [c.code, []]));
  for (const [start, end] of months) {
    const r = engineReport({ ...base, start, end });
    for (const c of scope) {
      const t = r.companyTotals.get(c.code);
      monthly.get(c.code)!.push({ sales: t?.sales ?? 0, credits: t?.credits ?? 0 });
    }
  }
  return {
    data_as_of: dataAsOf(),
    months: months.map(([s, e]) => ({ month: s.slice(0, 7), start: s, end: e, partial: e < monthEnd(s) })),
    companies: scope.map((c) => ({
      company: c.code, name: c.name, currency: c.currency,
      monthly: monthly.get(c.code)!.map((m) => ({ sales: round(m.sales), credits: round(m.credits), credit_pct: m.sales ? round((m.credits / m.sales) * 100) : null })),
      unpaid: unpaid(c.code, base.countSetAside, today),
    })),
  };
}

function unpaid(company: CompanyCode, countSetAside: boolean, today: string): Kpi["companies"][number]["unpaid"] {
  const buckets = new Map(AGING.map(([k]) => [k, 0]));
  const rows: { late: number; owed: number; inv: Dataset["invoices"][number] }[] = [];
  for (const inv of dataset().invoices) {
    if (inv.company !== company || inv.balance <= 0 || ["draft", "void", "paid"].includes(inv.status)) continue;
    if (resolve(inv.salesperson).kind === "set_aside" && !countSetAside) continue;
    const owed = (inv.balance / 100) * inv.exchange_rate;
    const late = daysBetween(inv.due_date, today);
    const key = AGING.find(([, , limit]) => limit === null || late <= limit)![0];
    buckets.set(key, buckets.get(key)! + owed);
    rows.push({ late, owed, inv });
  }
  const overdue = rows.filter((r) => r.late > 0).sort((a, b) => b.owed - a.owed || b.late - a.late);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  return {
    total: round(sum([...buckets.values()])),
    overdue: round(sum([...buckets.entries()].filter(([k]) => k !== "not_due").map(([, v]) => v))),
    invoices: rows.length,
    overdue_invoices: overdue.length,
    aging: AGING.map(([key, lbl]) => ({ key, label: lbl, amount: round(buckets.get(key)!) })),
    top_overdue: overdue.slice(0, 10).map(({ late, owed, inv }) => ({ id: inv.id, number: inv.number, customer: inv.customer,
      salesperson: resolve(inv.salesperson).name, due_date: inv.due_date, days_late: late, balance: round(owed) })),
  };
}

