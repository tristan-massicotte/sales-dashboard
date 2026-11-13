// Types of the dashboard's API, and the calls the pages make. In production these are HTTP routes on a
// FastAPI server; in this demo the same functions run in the browser on generated data (src/demo/server.ts).
// Amounts are in each company's own currency; USD and CAD are never added together.

import * as server from "./demo/server";

export type Period = "30" | "90" | "365" | "custom";
export type CompanyFilter = "" | "CAN" | "MED" | "INC"; // "" = all three

export type Filters = {
  period: Period;
  start: string; // YYYY-MM-DD, custom period only
  end: string;
  company: CompanyFilter;
  tax: boolean; // include taxes (default: before taxes)
  setAside: boolean; // count the set-aside (accounting) amounts in company totals: always true in this demo
  region: string; // "" = all; a code ("CA-QC") or "unknown" (map click)
  // Compare (custom period, main page only): a second custom period shown beside the first.
  compare: boolean;
  start2: string;
  end2: string;
};

export type RegionNet = {
  code: string;
  label: string;
  net: Record<string, number>; // per currency
  sales: Record<string, number>; // per currency (the map's colours)
  share_pct: number | null; // of total sales; approximate when USD and CAD are mixed (see Report.fx)
};

/** Average USD→CAD rate of the period, used only for the shares when both currencies are present. */
export type FxAverage = { source: string; usd_cad: number; first: string; last: string; days: number };

export type Totals = {
  currency: string;
  sales: number;
  credits: number;
  net: number;
  credit_pct: number | null;
};

export type CompanyLine = Totals & { company: string };

export type Kind = "person" | "distributor" | "set_aside" | "unassigned" | "unrecognized";

export type PersonRow = {
  name: string;
  kind: Kind;
  former: boolean;
  totals: Totals[];
  companies: CompanyLine[];
};

export type Report = {
  period: { start: string; end: string };
  filters: { company: string | null; region: string | null; tax: boolean; set_aside: boolean };
  data_as_of: string | null;
  salespeople: PersonRow[];
  set_aside: PersonRow[];
  companies: CompanyLine[];
  currency_totals: Totals[];
  regions: RegionNet[];
  fx: FxAverage | null;
  company_info: { code: string; name: string; currency: string }[]; // companies in scope
  unrecognized: string[];
  // 30 and 90 days only: each company's net over the same number of days just before.
  comparison: {
    period: { start: string; end: string };
    companies: { company: string; net: number; net_change_pct: number | null }[];
  } | null;
};

export type InvoiceRow = {
  id: string;
  number: string;
  date: string;
  company: string;
  currency: string;
  document_currency: string;
  status: string;
  customer: string;
  region: string;
  region_from_billing: boolean; // no region on the shipping address: taken from billing
  sales: number;
};

/** A credit note counted for the salesperson (their own, by its date), with where it was applied. */
export type CreditNoteRow = {
  id: string;
  number: string;
  date: string;
  company: string;
  currency: string;
  customer: string;
  status: string;
  counted: number;
  applied_to: { id: string; number: string; date: string | null; salesperson: string | null }[];
};

export type Documents = {
  name: string;
  invoices: InvoiceRow[];
  credit_notes: CreditNoteRow[];
};

export type InvoiceDetail = {
  id: string;
  number: string;
  date: string;
  company: string;
  status: string;
  customer: string;
  salesperson: string | null;
  currency: string;
  region: string;
  region_from_billing: boolean;
  sub_total: number;
  discount: number;
  shipping: number;
  adjustment: number;
  tax: number;
  total: number;
  credit_notes: { id: string; number: string; date: string; status: string; applied: number; applied_on: string; currency: string }[];
};

export type CreditNoteDetail = {
  id: string;
  number: string;
  date: string;
  company: string;
  status: string;
  customer: string;
  salesperson: string | null;
  currency: string;
  sub_total: number;
  tax: number;
  total: number;
  unapplied: number;
  invoices: { id: string; number: string; date: string | null; salesperson: string | null; status: string; applied: number; applied_on: string }[];
};

export type Month = { month: string; start: string; end: string; partial: boolean };
export type Kpi = {
  data_as_of: string;
  months: Month[];
  companies: {
    company: string;
    name: string;
    currency: string;
    monthly: { sales: number; credits: number; credit_pct: number | null }[];
    unpaid: {
      total: number;
      overdue: number;
      invoices: number;
      overdue_invoices: number;
      aging: { key: string; label: string; amount: number }[];
      top_overdue: { id: string; number: string; customer: string; salesperson: string; due_date: string | null; days_late: number; balance: number }[];
    };
  }[];
};

/** Same promise-based interface as the HTTP client, so the pages don't know the difference. */
function call<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    // Next tick: lets React paint the "loading" state first, like a network call would.
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
}

export const api = {
  report: (f: Filters) => call(() => server.report(f)),
  documents: (name: string, f: Filters) => call(() => server.documents(name, f)),
  invoice: (id: string) => call(() => server.invoice(id)),
  creditNote: (id: string) => call(() => server.creditNote(id)),
  kpi: (f: Filters) => call(() => server.kpi(f)),
};

/** A stable key for a set of filters (what an HTTP query string was in production). */
export function query(f: Filters): string {
  const q = new URLSearchParams({ period: f.period });
  if (f.period === "custom") {
    q.set("start", f.start);
    q.set("end", f.end);
  }
  if (f.company) q.set("company", f.company);
  if (f.tax) q.set("tax", "true");
  if (!f.setAside) q.set("set_aside", "false");
  if (f.region) q.set("region", f.region);
  return q.toString();
}

/** Period 2 of Compare: the same filters with the second dates. */
export function secondFilters(f: Filters): Filters {
  return { ...f, period: "custom", start: f.start2, end: f.end2, compare: false };
}
