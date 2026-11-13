import { Fragment, ReactNode, useState } from "react";
import { PersonRow, Report, Totals } from "./api";
import { amount, currencyLabel, money, pct } from "./format";

// One table per currency (CAD: Canada + Industrial; USD: Inc.), because USD and CAD are never added together.
// Someone selling in both currencies appears in both tables, each with their own total.
// Compare: the two periods side by side, each person on the same line in both halves (an empty line where
// they had nothing), and the change of the net on the second period's side.

type SortKey = "name" | "sales" | "credits" | "net" | "credit_pct";
type Sort = { key: SortKey; desc: boolean };

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Salesperson", numeric: false },
  { key: "sales", label: "Sales", numeric: true },
  { key: "credits", label: "Credit notes", numeric: true },
  { key: "net", label: "Net", numeric: true },
  { key: "credit_pct", label: "CN % of sales", numeric: true }, // "CN %" when comparing (half width)
];

export function displayName(p: { name: string; kind: string }): string {
  return p.kind === "unassigned" ? "Unassigned" : p.name;
}

/** Sort and expanded rows, shared by every table on screen (both halves when comparing, so they line up). */
function useTableState() {
  const [sort, setSort] = useState<Sort>({ key: "sales", desc: true });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };
  return { sort, setSort, open, toggle };
}

/** Currencies with something to show in any of the reports, CAD first (two companies out of three). */
function currenciesOf(reports: Report[]): string[] {
  const all = reports.flatMap((r) => [...r.salespeople, ...r.set_aside]).flatMap((p) => p.totals.map((t) => t.currency));
  return [...new Set(all)].sort((a, b) => (a === "CAD" ? -1 : b === "CAD" ? 1 : a.localeCompare(b)));
}

type Props = {
  report: Report;
  onOpen: (person: PersonRow) => void;
};

export function SalesTables({ report, onOpen }: Props) {
  const state = useTableState();
  const currencies = currenciesOf([report]);
  if (currencies.length === 0) {
    return <p className="empty">No invoices or credit notes in this period.</p>;
  }
  return (
    <>
      {currencies.map((currency) => (
        <CurrencyTable key={currency} currency={currency} report={report} reports={[report]} state={state} onOpen={onOpen} />
      ))}
    </>
  );
}

/** Compare mode: per currency, period 1's table and period 2's side by side, rows aligned. */
export function CompareTables({ first, second, onOpen }: {
  first: Report; second: Report; onOpen: (person: PersonRow, side: 1 | 2) => void;
}) {
  const state = useTableState();
  const reports = [first, second];
  const currencies = currenciesOf(reports);
  if (currencies.length === 0) {
    return <p className="empty">No invoices or credit notes in either period.</p>;
  }
  return (
    <>
      {currencies.map((currency) => (
        <div key={currency} className="pair">
          <CurrencyTable currency={currency} report={first} reports={reports} state={state} onOpen={(p) => onOpen(p, 1)}
            caption={<span className="period-badge p1">Period 1</span>} />
          <CurrencyTable currency={currency} report={second} reports={reports} base={first} state={state} onOpen={(p) => onOpen(p, 2)}
            caption={<span className="period-badge p2">Period 2</span>} />
        </div>
      ))}
    </>
  );
}

function sortValue(t: Totals, key: SortKey): number {
  if (key === "credit_pct") return t.credit_pct ?? -Infinity;
  return t[key as "sales" | "credits" | "net"];
}

function CurrencyTable({ currency, report, reports, base, state, onOpen, caption }: {
  currency: string;
  report: Report; // what this table shows
  reports: Report[]; // every report on screen: rows, sub-rows and footer line up across them
  base?: Report; // compare mode, period 2's side: change of the net against this report
  state: ReturnType<typeof useTableState>;
  onOpen: (p: PersonRow) => void;
  caption?: ReactNode;
}) {
  const { sort, setSort, open, toggle } = state;
  const bare = reports.length > 1; // compare tables are half as wide: amounts without "$ US", the title says it
  const companies = report.company_info.filter((c) => c.currency === currency);
  const companyOrder = report.company_info.map((c) => c.code);
  const companyName = (code: string) => report.company_info.find((c) => c.code === code)?.name ?? code;
  const inCurrency = (p: PersonRow | undefined) => p?.totals.find((t) => t.currency === currency);
  const find = (list: PersonRow[] | undefined, name: string) => list?.find((p) => p.name === name);
  const anywhere = (name: string, aside: boolean) =>
    reports.map((r) => find(aside ? r.set_aside : r.salespeople, name)).find((p) => inCurrency(p))!;

  // Everyone with something in this currency in any report, sorted by the first report that has them.
  const seen = new Map<string, { p: PersonRow; t: Totals }>();
  for (const r of reports) {
    for (const p of r.salespeople) {
      const t = inCurrency(p);
      if (t && !seen.has(p.name)) seen.set(p.name, { p, t });
    }
  }
  const order = [...seen.values()].sort((a, b) => {
    // "Unassigned" (invoices without a salesperson) last, whatever the sort.
    const rank = (x: { p: PersonRow }) => (x.p.kind === "unassigned" ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    let d = sort.key === "name"
      ? displayName(a.p).localeCompare(displayName(b.p), "en")
      : sortValue(a.t, sort.key) - sortValue(b.t, sort.key);
    if (sort.desc) d = -d;
    return d || displayName(a.p).localeCompare(displayName(b.p), "en");
  }).map((x) => x.p.name);
  const setAsideNames = [...new Set(reports.flatMap((r) => r.set_aside.filter(inCurrency).map((p) => p.name)))].sort();
  const total = report.currency_totals.find((t) => t.currency === currency);
  const baseTotal = base?.currency_totals.find((t) => t.currency === currency);

  // A person's companies in this currency, in any report (the same sub-rows on both sides).
  const companyCodes = (name: string, aside: boolean) =>
    [...new Set(reports.flatMap((r) => find(aside ? r.set_aside : r.salespeople, name)?.companies ?? [])
      .filter((c) => c.currency === currency).map((c) => c.company))]
      .sort((a, b) => companyOrder.indexOf(a) - companyOrder.indexOf(b));
  const lineOf = (p: PersonRow | undefined, code: string) => p?.companies.find((c) => c.company === code && c.currency === currency);

  const header = (key: SortKey) => {
    const active = sort.key === key;
    return () => setSort({ key, desc: active ? !sort.desc : key !== "name" });
  };

  return (
    <section className="card table-card">
      <h2>
        {caption}
        {companies.length ? companies.map((c) => c.name).join(" + ") : currency}
        <span className="currency-tag">{currencyLabel(currency)}</span>
      </h2>
      <table className="sales">
        <colgroup>
          <col />
          <col className="amount" /><col className="amount" /><col className="amount" /><col className="pct" />
          {base && <col className="change" />}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className={c.numeric ? "num" : ""} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                <button type="button" className="sort" onClick={header(c.key)} title={c.label}>
                  {reports.length > 1 && c.key === "credit_pct" ? "CN %" : c.label}
                  <span className="arrow">{sort.key === c.key ? (sort.desc ? "▼" : "▲") : ""}</span>
                </button>
              </th>
            ))}
            {base && <th className="num" title="Change of the net against period 1">Change</th>}
          </tr>
        </thead>
        <tbody>
          {order.map((name) => {
            const p = find(report.salespeople, name);
            const t = inCurrency(p);
            const before = find(base?.salespeople, name);
            const codes = companyCodes(name, false);
            const key = `${currency}|${name}`;
            const expanded = open.has(key);
            const shown = t ? p! : anywhere(name, false);
            return (
              <Fragment key={name}>
                <tr className={`person ${shown.kind}${t ? "" : " absent"}`}>
                  <td>
                    <span className="name-cell">
                      {codes.length > 1 ? (
                        <button type="button" className="chevron" aria-expanded={expanded}
                          aria-label={expanded ? "Hide companies" : "Show by company"} onClick={() => toggle(key)}>
                          {expanded ? "▾" : "▸"}
                        </button>
                      ) : <span className="chevron-space" />}
                      {t ? (
                        <button type="button" className="link" onClick={() => onOpen(p!)} title="See invoices and credit notes">
                          {displayName(shown)}
                        </button>
                      ) : <span className="absent-name" title="Nothing in this period">{displayName(shown)}</span>}
                      <Tags person={shown} />
                    </span>
                  </td>
                  {t ? <Amounts t={t} bare={bare} /> : <Blank />}
                  {base && <ChangeCell now={t?.net} before={inCurrency(before)?.net} currency={currency} />}
                </tr>
                {expanded && codes.map((code) => {
                  const l = lineOf(p, code);
                  return (
                    <tr key={code} className="sub">
                      <td><span className="indent">{companyName(code)}</span></td>
                      {l ? <Amounts t={l} bare={bare} /> : <Blank />}
                      {base && <ChangeCell now={l?.net} before={lineOf(before, code)?.net} currency={currency} />}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="total">
            <td>Total</td>
            {total ? <Amounts t={total} bare={bare} /> : <Blank />}
            {base && <ChangeCell now={total?.net} before={baseTotal?.net} currency={currency} />}
          </tr>
          {setAsideNames.map((name) => {
            const p = find(report.set_aside, name);
            const t = inCurrency(p);
            return (
              <tr key={name} className={`set-aside${t ? "" : " absent"}`}>
                <td>
                  <span className="name-cell">
                    <span className="chevron-space" />
                    {t ? <button type="button" className="link" onClick={() => onOpen(p!)}>{name}</button>
                      : <span className="absent-name">{name}</span>}
                    <span className="tag">Set aside</span>
                    <span className="muted small">{report.filters.set_aside ? "counted in the total" : "not counted in the total"}</span>
                  </span>
                </td>
                {t ? <Amounts t={t} bare={bare} /> : <Blank />}
                {base && <ChangeCell now={t?.net} before={inCurrency(find(base.set_aside, name))?.net} currency={currency} />}
              </tr>
            );
          })}
        </tfoot>
      </table>
    </section>
  );
}

function Tags({ person }: { person: PersonRow }) {
  return (
    <>
      {person.former && <span className="tag">Former</span>}
      {person.kind === "distributor" && <span className="tag">Distributor</span>}
    </>
  );
}

function Amounts({ t, bare }: { t: Totals; bare?: boolean }) {
  const m = (v: number) => (bare ? amount(v) : money(v, t.currency));
  return (
    <>
      <td className="num">{m(t.sales)}</td>
      <td className="num">{m(t.credits)}</td>
      <td className="num strong">{m(t.net)}</td>
      <td className="num">{pct(t.credit_pct)}</td>
    </>
  );
}

/** Nothing in this period: dashes, so the line still lines up with the other period's. */
function Blank() {
  return <>{[0, 1, 2, 3].map((i) => <td key={i} className="num muted">—</td>)}</>;
}

/** % change of the net, period 2 against period 1 (on |period 1's net|; none when it was 0 or absent). */
export function changePct(now: number | undefined, before: number | undefined): number | null {
  if (now === undefined || before === undefined || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

function ChangeCell({ now, before, currency }: { now?: number; before?: number; currency: string }) {
  const v = changePct(now ?? 0, before);
  const title = before === undefined ? "Nothing in period 1" : `Net in period 1: ${money(before, currency)}`;
  if (v === null || (now === undefined && before === undefined)) return <td className="num muted" title={title}>—</td>;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "";
  return (
    <td className={`num change ${cls}`} title={`${title} · change ${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v))}`}>
      {v > 0 ? "▲ " : v < 0 ? "▼ " : "■ "}{shortPct(v)}
    </td>
  );
}

/** Narrow column: one decimal under 100%, whole numbers up to 999%, then "> +999%" (exact value on hover). */
function shortPct(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a > 999) return `> ${sign}999%`;
  return `${sign}${a >= 100 ? `${Math.round(a)}%` : pct(a)}`;
}
