import { useCallback, useEffect, useState } from "react";
import { api, CompanyFilter, Filters, Period, PersonRow, query, Report, secondFilters } from "./api";
import { SalespersonPanel } from "./Drilldown";
import { day, money, pct } from "./format";
import { Header } from "./Header";
import { KpiPage } from "./KpiPage";
import { SalesMap, UNKNOWN } from "./SalesMap";
import { changePct, CompareTables, SalesTables } from "./SalesTable";

// The filters and the page live in the address bar, so a view can be bookmarked or sent as a link.

export type Page = "sales" | "map" | "kpi";

const REPO = "https://github.com/tristan-massicotte/sales-dashboard";

const DEFAULTS: Filters = { period: "30", start: "", end: "", company: "", tax: false, setAside: true, region: "",
  compare: false, start2: "", end2: "" };

function readUrl(): Filters {
  const q = new URLSearchParams(window.location.search);
  const period = q.get("period");
  const company = q.get("company");
  return {
    period: (["30", "90", "365", "custom"].includes(period ?? "") ? period : DEFAULTS.period) as Period,
    start: q.get("start") ?? "",
    end: q.get("end") ?? "",
    company: (["CAN", "MED", "INC"].includes(company ?? "") ? company : "") as CompanyFilter,
    tax: q.get("tax") === "true",
    setAside: true, // accounting entries always count in the company totals
    region: q.get("region") ?? "",
    compare: period === "custom" && q.get("compare") === "1",
    start2: q.get("start2") ?? "",
    end2: q.get("end2") ?? "",
  };
}

function readPage(): Page {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "map" || view === "kpi" ? view : "sales";
}

function writeUrl(f: Filters, page: Page) {
  const q = new URLSearchParams();
  if (page !== "sales") q.set("view", page);
  if (f.period !== DEFAULTS.period) q.set("period", f.period);
  if (f.period === "custom") {
    if (f.start) q.set("start", f.start);
    if (f.end) q.set("end", f.end);
    if (f.compare) {
      q.set("compare", "1");
      if (f.start2) q.set("start2", f.start2);
      if (f.end2) q.set("end2", f.end2);
    }
  }
  if (f.company) q.set("company", f.company);
  if (f.tax) q.set("tax", "true");
  if (f.region) q.set("region", f.region);
  const s = q.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

/** A custom period needs both dates, in order, before it can be asked for. */
function ready(f: Filters): boolean {
  return f.period !== "custom" || (!!f.start && !!f.end && f.start <= f.end);
}

export function App() {
  const [filters, setFilters] = useState<Filters>(readUrl);
  const [page, setPage] = useState<Page>(readPage);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [person, setPerson] = useState<{ row: PersonRow; side: 1 | 2 } | null>(null);
  // Compare (custom period, main page only): period 2's report, shown beside period 1's.
  const comparing = page === "sales" && filters.period === "custom" && filters.compare;
  const second = comparing ? secondFilters(filters) : null;
  const [report2, setReport2] = useState<Report | null>(null);
  const [error2, setError2] = useState<string | null>(null);
  // The map always shows every region: with a region selected, it uses the same report without that filter.
  const [mapReport, setMapReport] = useState<Report | null>(null);

  useEffect(() => writeUrl(filters, page), [filters, page]);

  useEffect(() => {
    if (!ready(filters)) return;
    let current = true;
    setLoading(true);
    const forMap = filters.region ? api.report({ ...filters, region: "" }) : null;
    api.report(filters).then(
      async (r) => {
        const m = forMap ? await forMap : r;
        if (!current) return;
        setReport(r);
        setMapReport(m);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (!current) return;
        setError(String(e.message ?? e));
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [filters]);

  const secondKey = second && ready(second) ? query(second) : "";
  useEffect(() => {
    setReport2(null);
    if (!secondKey) return;
    let current = true;
    api.report(secondFilters(filters)).then(
      (r) => { if (current) { setReport2(r); setError2(null); } },
      (e) => { if (current) setError2(String(e.message ?? e)); },
    );
    return () => {
      current = false;
    };
  }, [secondKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Choosing "Custom" starts from the period on screen.
  const changeFilters = (f: Filters) => {
    if (f.period === "custom" && report && !f.start && !f.end) {
      f = { ...f, start: report.period.start, end: report.period.end };
    }
    setFilters(f);
  };
  const selectRegion = (code: string) => setFilters((f) => ({ ...f, region: f.region === code ? "" : code }));
  // On the map, choosing a region opens the sales page filtered to it.
  const openRegion = (code: string) => {
    setFilters((f) => ({ ...f, region: code }));
    setPage("sales");
    window.scrollTo(0, 0);
  };
  const regionLabel = filters.region === UNKNOWN ? "Unknown region"
    : mapReport?.regions.find((r) => r.code === filters.region)?.label ?? filters.region;

  const closePanel = useCallback(() => setPerson(null), []);

  return (
    <>
      <Header filters={filters} onChange={changeFilters} page={page} onPage={setPage} dataAsOf={report?.data_as_of ?? null}
        regionLabel={filters.region ? regionLabel : ""} />
      <main className={`${loading ? "loading" : ""}${comparing ? " wide" : ""}`}>
        {!ready(filters) && <p className="notice">Choose a start date and an end date (in order).</p>}
        {second && !ready(second) && <p className="notice">Period 2: choose a start date and an end date (in order).</p>}
        {error && <p className="error">{error}</p>}
        {comparing && error2 && <p className="error">Period 2: {error2}</p>}
        {report && (
          <>
            <div className="period-line">
              <p>
                {comparing && <span className="period-badge p1">Period 1</span>}
                <strong>{day(report.period.start)}</strong> to <strong>{day(report.period.end)}</strong>
                {comparing && report2 && (
                  <>
                    {" "}<span className="period-badge p2">Period 2</span>
                    <strong>{day(report2.period.start)}</strong> to <strong>{day(report2.period.end)}</strong>
                  </>
                )}
                {" · "}{filters.tax ? "taxes included" : "before taxes"}
                {" · "}credit notes by their own salesperson and date
              </p>
              {page === "sales" && (
                <span className="downloads">
                  {!comparing && <ExcelButton filters={filters} />}
                  {/* Any period: a deck of that period; with Compare: period 2 against period 1 */}
                  {(!comparing || report2) && <PowerPointButton filters={filters} compare={comparing} />}
                </span>
              )}
            </div>
            {filters.region && page === "sales" && (
              <p className="region-chip">
                <span>
                  Filtered to <strong>{regionLabel}</strong>: cards and tables only count invoices shipped there (and the
                  credit notes applied to them).
                </span>
                <button type="button" className="secondary small" onClick={() => selectRegion(filters.region)}>✕ All regions</button>
              </p>
            )}
            {page === "sales" && !comparing && (
              <>
                <CompanyCards report={report} region={filters.region ? regionLabel : ""} />
                <SalesTables report={report} onOpen={(row) => setPerson({ row, side: 1 })} />
              </>
            )}
            {comparing && report2 && (
              <div className="compare">
                <div className="pair">
                  <CompanyCards report={report} region={filters.region ? regionLabel : ""} reserve />
                  <CompanyCards report={report2} region={filters.region ? regionLabel : ""} base={report} />
                </div>
                <CompareTables first={report} second={report2} onOpen={(row, side) => setPerson({ row, side })} />
              </div>
            )}
            {comparing && !report2 && second && ready(second) && !error2 && <p className="muted">Loading period 2…</p>}
            {page === "kpi" && <KpiPage filters={filters} />}
            {page === "map" && mapReport && (
              <SalesMap regions={mapReport.regions} fx={mapReport.fx} selected={filters.region} onSelect={openRegion} />
            )}
          </>
        )}
        {!report && !error && ready(filters) && <p className="muted">Loading…</p>}
      </main>
      <footer className="footer">
        <p>
          <strong>Demo.</strong> Halden Canada, Halden Medical and Halden Inc. are fictional; every customer, salesperson and
          amount is generated in your browser. The production version of this dashboard runs on real ERP data.
        </p>
        <p>
          Built by Tristan Massicotte · <a href={REPO} target="_blank" rel="noreferrer">Source and write-up on GitHub ↗</a>
        </p>
      </footer>
      {person && report && (person.side === 1 || report2) && (
        <SalespersonPanel person={person.row} filters={person.side === 2 ? secondFilters(filters) : filters}
          period={person.side === 2 ? report2!.period : report.period} onClose={closePanel} />
      )}
    </>
  );
}

/** One card per company. Compare mode: period 2's cards (base = period 1) show the change of the net;
 * period 1's keep an empty line in its place (reserve), so the two rows of cards line up. */
function CompanyCards({ report, region, base, reserve }: { report: Report; region: string; base?: Report; reserve?: boolean }) {
  return (
    <div className="cards">
      {report.company_info.map((info) => {
        const c = report.companies.find((l) => l.company === info.code);
        const m = (v: number | undefined) => money(v ?? 0, info.currency);
        return (
          <section key={info.code} className="card kpi">
            <h2>
              {base && <span className="period-badge p2">Period 2</span>}
              {reserve && <span className="period-badge p1">Period 1</span>}
              {info.name}{region && <span className="region-in-title"> · {region}</span>}
            </h2>
            <div className="kpi-net">{m(c?.net)}</div>
            <div className="kpi-label">Net</div>
            {base ? <VersusFirst now={c?.net ?? 0} before={base.companies.find((l) => l.company === info.code)?.net} currency={info.currency} />
              : reserve ? <div className="change" aria-hidden="true">&nbsp;</div>
              : report.comparison && <Change report={report} company={info.code} currency={info.currency} />}
            <dl>
              <dt>Sales</dt><dd>{m(c?.sales)}</dd>
              <dt>Credit notes</dt><dd>{m(c?.credits)}</dd>
              <dt>CN % of sales</dt><dd>{pct(c?.credit_pct ?? null)}</dd>
            </dl>
          </section>
        );
      })}
    </div>
  );
}

/** % change of the net against the same number of days just before (30 and 90 days only). */
function Change({ report, company, currency }: { report: Report; company: string; currency: string }) {
  const cmp = report.comparison!;
  const prev = cmp.companies.find((c) => c.company === company);
  if (!prev) return null;
  const days = Math.round((Date.parse(report.period.end) - Date.parse(report.period.start)) / 86400000) + 1;
  const title = `Net from ${day(cmp.period.start)} to ${day(cmp.period.end)}: ${money(prev.net, currency)}`;
  if (prev.net_change_pct === null) {
    return <div className="change" title={title}>Nothing to compare in the previous {days} days</div>;
  }
  const v = prev.net_change_pct;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return (
    <div className={`change ${cls}`} title={title}>
      {v > 0 ? "▲" : v < 0 ? "▼" : "■"} {sign}{pct(Math.abs(v))} <span className="muted">vs previous {days} days</span>
    </div>
  );
}

/** Compare mode, period 2's cards: % change of the net against period 1. */
function VersusFirst({ now, before, currency }: { now: number; before: number | undefined; currency: string }) {
  const v = changePct(now, before ?? 0);
  const title = `Net in period 1: ${money(before ?? 0, currency)}`;
  if (v === null) return <div className="change" title={title}>Nothing to compare in period 1</div>;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "";
  return (
    <div className={`change ${cls}`} title={title}>
      {v > 0 ? "▲ +" : v < 0 ? "▼ −" : "■ "}{pct(Math.abs(v))} <span className="muted">vs period 1</span>
    </div>
  );
}

/** Excel: one sheet per company, built in the browser (the export library loads on first click). */
function ExcelButton({ filters }: { filters: Filters }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { downloadWorkbook } = await import("./export/excel");
      await downloadWorkbook(filters);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="excel" onClick={download} disabled={busy}
      title="Download as Excel: one sheet per company (sales, credit notes and net), with the filters on screen">
      <ExcelIcon /> {busy ? "Building…" : "Excel"}
    </button>
  );
}

const PRESENTER_KEY = "sales-dashboard.presenter"; // remembered in this browser only

/** The PowerPoint for the leadership meeting, after asking for the presenter's name. With Compare, period 2 (the
 * recent one) against period 1; otherwise the period on screen (30, 90, 365 days or custom) alone. */
function PowerPointButton({ filters, compare }: { filters: Filters; compare: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [presenter, setPresenter] = useState(() => {
    try {
      return localStorage.getItem(PRESENTER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const download = async () => {
    try {
      localStorage.setItem(PRESENTER_KEY, presenter.trim());
    } catch {
      /* private window: just not remembered */
    }
    setBusy(true);
    try {
      const { downloadDeck } = await import("./export/deck");
      await downloadDeck(filters, compare, presenter.trim().slice(0, 80));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="pptx-wrap">
      <button type="button" className="excel" aria-expanded={open} onClick={() => setOpen(!open)}
        title={compare ? "Download a PowerPoint deck: period 2 compared with period 1"
          : "Download a PowerPoint deck of the chosen period"}>
        <PowerPointIcon /> PowerPoint
      </button>
      {open && (
        <span className="pptx-pop card">
          <label>
            Presenter
            <input type="text" value={presenter} maxLength={80} placeholder="Name (optional)" autoFocus
              onChange={(e) => setPresenter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && download()} />
          </label>
          <button type="button" className="pptx-go" onClick={download} disabled={busy}>
            {busy ? "Building…" : "Download"}
          </button>
        </span>
      )}
    </span>
  );
}

/** A generic orange slide icon (not a brand logo). */
function PowerPointIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="3" width="20" height="15" rx="2.5" fill="#c4502a" />
      <rect x="5.5" y="11" width="2.6" height="4" rx=".5" fill="#ffffff" />
      <rect x="9.7" y="8" width="2.6" height="7" rx=".5" fill="#ffffff" />
      <rect x="13.9" y="6" width="2.6" height="9" rx=".5" fill="#ffffff" />
      <path d="M12 18v3M8 21h8" stroke="#c4502a" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A generic green spreadsheet icon (not a brand logo). */
function ExcelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="2" width="18" height="20" rx="2.5" fill="#1d7a45" />
      <path d="M3 8h18M3 13h18M3 18h18M10 8v14" stroke="#ffffff" strokeOpacity=".35" strokeWidth="1" />
      <path d="M7.2 9.8l4.6 7M11.8 9.8l-4.6 7" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
