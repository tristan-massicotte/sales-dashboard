// The checks the production version was verified on, against real data, run here on the demo data:
// rows add up to the totals to the cent, each person's documents add up to their row, and regions add up to the
// net, for every period and filter combination.

import { describe, expect, it } from "vitest";
import type { Filters } from "../api";
import { generate } from "./data";
import { compute } from "./engine";
import * as server from "./server";

const TODAY = "2026-11-12";
const ds = generate(TODAY);
// Point the "server" at a fixed day so the test doesn't depend on when it runs.
server.useDataset(ds);

const base: Filters = { period: "custom", start: "", end: "", company: "", tax: false, setAside: true, region: "",
  compare: false, start2: "", end2: "" };
const PERIODS: [string, string][] = [["2026-10-14", TODAY], ["2026-08-15", TODAY], ["2025-11-13", TODAY], ["2026-07-01", "2026-09-30"]];
const cents = (v: number) => Math.round(v * 100);

describe("demo data", () => {
  it("has a realistic volume", () => {
    const year = ds.invoices.filter((i) => i.date >= "2025-11-13");
    expect(year.length).toBeGreaterThan(1300);
    expect(year.length).toBeLessThan(2600);
    expect(ds.creditNotes.length).toBeGreaterThan(50);
    expect(ds.applications.length).toBeGreaterThan(30);
    expect(ds.invoices.every((i) => i.date <= TODAY)).toBe(true);
  });

  it("is the same for the same day", () => {
    const again = generate(TODAY);
    expect(again.invoices.length).toBe(ds.invoices.length);
    expect(again.invoices[123]).toEqual(ds.invoices[123]);
  });

  it("keeps past months stable as days pass", () => {
    const later = generate("2026-12-03");
    const sept = (d: typeof ds) => d.invoices.filter((i) => i.date.startsWith("2026-09")).map((i) => i.number + i.amounts.total);
    expect(sept(later)).toEqual(sept(ds));
  });
});

describe("engine", () => {
  for (const [start, end] of PERIODS) {
    for (const company of ["", "CAN", "IND", "INC"] as const) {
      for (const tax of [false, true]) {
        for (const setAside of [false, true]) {
          it(`adds up: ${start}..${end} ${company || "all"} tax=${tax} setAside=${setAside}`, () => {
            const o = { start, end, includeTax: tax, countSetAside: setAside, company: company || null, region: null };
            const r = compute(ds, o);
            // Company totals = sum of the lines they absorb.
            for (const [code, t] of r.companyTotals) {
              const lines = r.lines.filter((l) => l.company === code && (setAside || l.salesperson.kind !== "set_aside"));
              expect(cents(lines.reduce((s, l) => s + l.sales, 0))).toBe(cents(t.sales));
              expect(cents(lines.reduce((s, l) => s + l.credits, 0))).toBe(cents(t.credits));
            }
            // Each line = its entries.
            for (const l of r.lines) {
              const sales = l.entries.filter((e) => e.kind === "sale").reduce((s, e) => s + e.amount, 0);
              expect(cents(sales)).toBe(cents(l.sales));
            }
            // Regions (sales) add up to the sales in the totals, per currency.
            for (const cur of ["CAD", "USD"] as const) {
              const map = [...r.regionSales.values()].reduce((s, v) => s + (v[cur] ?? 0), 0);
              const totals = [...r.companyTotals.values()].filter((t) => t.currency === cur).reduce((s, t) => s + t.sales, 0);
              expect(cents(map)).toBe(cents(totals));
            }
          });
        }
      }
    }
  }

  it("a region filter equals that region's map value", () => {
    const o = { start: "2025-11-13", end: TODAY, includeTax: false, countSetAside: true, company: null, region: null };
    const all = compute(ds, o);
    for (const code of ["CA-QC", "US-TX", "W-ES"]) {
      const one = compute(ds, { ...o, region: code });
      for (const cur of ["CAD", "USD"] as const) {
        const net = [...one.companyTotals.values()].filter((t) => t.currency === cur).reduce((s, t) => s + t.net, 0);
        expect(cents(net)).toBe(cents(all.regions.get(code)?.[cur] ?? 0));
      }
    }
  });

  it("drafts and void documents never count", () => {
    const r = compute(ds, { start: "2024-01-01", end: TODAY, includeTax: false, countSetAside: true, company: null, region: null });
    const counted = r.lines.flatMap((l) => l.entries.map((e) => (e.invoice ?? e.creditNote)!.status));
    expect(counted.some((s) => s === "void" || s === "draft")).toBe(false);
  });
});

describe("API shapes", () => {
  it("report rows add up to the currency totals, and drill-down to each row", () => {
    const f = { ...base, start: "2026-08-15", end: TODAY };
    const rep = server.report(f);
    for (const t of rep.currency_totals) {
      const rows = rep.salespeople.flatMap((p) => p.totals.filter((x) => x.currency === t.currency));
      const aside = rep.set_aside.flatMap((p) => p.totals.filter((x) => x.currency === t.currency));
      const sum = [...rows, ...(f.setAside ? aside : [])].reduce((s, x) => s + cents(x.sales), 0);
      expect(Math.abs(sum - cents(t.sales))).toBeLessThanOrEqual(rows.length); // each row rounded to the cent
    }
    const person = rep.salespeople[0];
    const docs = server.documents(person.name, f);
    const sales = docs.invoices.reduce((s, i) => s + cents(i.sales), 0);
    const total = person.totals.reduce((s, t) => s + cents(t.sales), 0);
    expect(Math.abs(sales - total)).toBeLessThanOrEqual(docs.invoices.length);
  });

  it("KPI months match the report for that month", () => {
    const kpi = server.kpi({ ...base, period: "30" });
    const m = kpi.months[kpi.months.length - 3];
    const rep = server.report({ ...base, start: m.start, end: m.end });
    for (const c of kpi.companies) {
      const i = kpi.months.length - 3;
      expect(c.monthly[i].sales).toBe(rep.companies.find((x) => x.company === c.company)?.sales ?? 0);
    }
  });
});
