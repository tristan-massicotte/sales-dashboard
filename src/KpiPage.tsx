import { useEffect, useState } from "react";
import { BarChart, HBars, LineChart } from "./charts";
import { api, Filters, Kpi as KpiData } from "./api";
import { day, money, pct } from "./format";

// KPI page: monthly sales and credit-note rate over the last 12 months whatever the period, unpaid invoices
// as of today. One chart per company, each in its own currency (blue CAD, red USD, like the map); nothing
// converted or added.

type Month = KpiData["months"][number];

const color = (currency: string) => (currency === "USD" ? "var(--usd)" : "var(--cad)");

function monthLabel(m: Month, i: number): string {
  const d = new Date(`${m.start}T12:00:00`);
  const name = d.toLocaleDateString("en-CA", { month: "short" }).replace(".", "");
  return i === 0 || d.getMonth() === 0 ? `${name} ${String(d.getFullYear()).slice(2)}` : name;
}

function monthLong(m: Month): string {
  const d = new Date(`${m.start}T12:00:00`);
  const name = d.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  return m.partial ? `${name} (in progress, to ${day(m.end)})` : name;
}

export function KpiPage({ filters }: { filters: Filters }) {
  const [data, setData] = useState<KpiData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.kpi({ ...filters, region: "" })
      .then((d) => current && (setData(d), setError(null)), (e) => current && setError(String(e.message ?? e)));
    return () => {
      current = false;
    };
  }, [filters]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const labels = data.months.map(monthLabel);
  const partial = data.months.map((m) => m.partial);
  const cos = data.companies;

  return (
    <div className="kpi-page">
      <p className="muted small kpi-intro">
        Monthly sales and credit-note rate: last 12 months (the current month is paler), whatever the period
        chosen; unpaid invoices: as of today. The other filters apply. Each company in its own currency.
      </p>

      <h2 className="kpi-h">Monthly sales</h2>
      <div className="kpi-grid">
        {cos.map((c) => (
          <section key={c.company} className="card kpi-card">
            <h3>{c.name} <span className="currency-tag">{c.currency}</span></h3>
            <BarChart values={c.monthly.map((m) => m.sales)} labels={labels} partial={partial} color={color(c.currency)}
              tips={c.monthly.map((m, i) => [monthLong(data.months[i]), `Sales ${money(m.sales, c.currency)}`,
                `Credit notes ${money(m.credits, c.currency)}`, `Net ${money(m.sales - m.credits, c.currency)}`])} />
          </section>
        ))}
      </div>

      <h2 className="kpi-h">Credit-note rate <span className="muted small">(credit notes of the month ÷ sales of the month)</span></h2>
      <div className="kpi-grid">
        {cos.map((c) => (
          <section key={c.company} className="card kpi-card">
            <h3>{c.name}</h3>
            <LineChart values={c.monthly.map((m) => m.credit_pct)} labels={labels} color={color(c.currency)}
              format={(v) => `${Math.round(v)}%`}
              tips={c.monthly.map((m, i) => [monthLong(data.months[i]), m.credit_pct === null ? "No sales" : pct(m.credit_pct),
                `${money(m.credits, c.currency)} of ${money(m.sales, c.currency)}`])} />
          </section>
        ))}
      </div>

      <h2 className="kpi-h">Unpaid invoices <span className="muted small">(as of today, all dates; balance including taxes, as in the ERP)</span></h2>
      <div className="kpi-grid wide">
        {cos.map((c) => {
          const u = c.unpaid;
          return (
            <section key={c.company} className="card kpi-card">
              <h3>{c.name}</h3>
              <div className="unpaid-head">
                <div><div className="kpi-label">Receivable</div><div className="big">{money(u.total, c.currency)}</div>
                  <div className="muted small">{u.invoices} invoice{u.invoices === 1 ? "" : "s"}</div></div>
                <div><div className="kpi-label">Overdue</div><div className={`big ${u.overdue > 0 ? "late" : ""}`}>{money(u.overdue, c.currency)}</div>
                  <div className="muted small">{u.overdue_invoices} invoice{u.overdue_invoices === 1 ? "" : "s"}</div></div>
              </div>
              <HBars color={color(c.currency)} rows={u.aging.map((a) => ({ label: a.label, value: a.amount, text: money(a.amount, c.currency) }))} />
              {u.top_overdue.length > 0 && (
                <>
                  <h4>Largest overdue balances</h4>
                  <div className="scroll">
                    <table className="docs">
                      <thead><tr><th>Invoice</th><th>Customer</th><th className="num">Balance</th><th className="num">Late</th><th>Salesperson</th><th>Due</th></tr></thead>
                      <tbody>
                        {u.top_overdue.map((o) => (
                          <tr key={o.number}>
                            <td className="nowrap">{o.number}</td>
                            <td className="clip" title={o.customer}>{o.customer}</td>
                            <td className="num">{money(o.balance, c.currency)}</td>
                            <td className="num">{o.days_late} d</td>
                            <td className="clip">{o.salesperson}</td>
                            <td className="nowrap">{day(o.due_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
