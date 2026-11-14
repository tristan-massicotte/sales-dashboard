import { useState } from "react";
import { Filters, Period } from "./api";
import type { Page } from "./App";
import { dateTime } from "./format";

const PERIODS: { value: Period; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: "custom", label: "Custom" },
];

const COMPANIES: { value: Filters["company"]; label: string }[] = [
  { value: "", label: "All" },
  { value: "CAN", label: "Canada" },
  { value: "IND", label: "Industrial" },
  { value: "INC", label: "Inc." },
];

// "Sales Dashboard" (the title) is the main page: cards and salesperson tables.
const PAGES: { value: Page; label: string }[] = [
  { value: "map", label: "Map" },
  { value: "kpi", label: "KPI" },
];

type Props = {
  filters: Filters;
  onChange: (f: Filters) => void;
  page: Page;
  onPage: (p: Page) => void;
  regionLabel: string; // "" when no region filter
  dataAsOf: string | null;
};

const TABS_SEEN_KEY = "tabs-seen";

function readTabsSeen(): boolean {
  try {
    return localStorage.getItem(TABS_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function Header({ filters, onChange, page, onPage, regionLabel, dataAsOf }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  // Map and KPI pulse until the visitor has opened one of them once.
  const [tabsSeen, setTabsSeen] = useState(readTabsSeen);
  const openPage = (p: Page) => {
    if (p !== "sales" && !tabsSeen) {
      setTabsSeen(true);
      try {
        localStorage.setItem(TABS_SEEN_KEY, "1");
      } catch {
        // private window: the hint comes back on the next visit
      }
    }
    onPage(p);
  };

  return (
    <header className="header">
      <div className="brand">
        <Mark />
        <div>
          <nav className="tabs" aria-label="Pages">
            <h1>
              <button type="button" className={page === "sales" ? "on" : ""}
                aria-current={page === "sales" ? "page" : undefined} onClick={() => openPage("sales")}>
                Sales Dashboard
              </button>
            </h1>
            {PAGES.map((p) => (
              <button key={p.value} type="button"
                className={page === p.value ? "on" : !tabsSeen && page === "sales" ? "hint" : ""}
                aria-current={page === p.value ? "page" : undefined} onClick={() => openPage(p.value)}>
                {p.label}
              </button>
            ))}
          </nav>
          <div className="refresh">
            <span className="subtitle">Data as of {dateTime(dataAsOf)}</span>
            <span className="demo-badge" title="Fictional companies; data generated in your browser">Demo data</span>
          </div>
        </div>
      </div>
      <div className="corner">
        <ThemeToggle />
      </div>

      <div className="filters">
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" className={filters.period === p.value ? "on" : ""}
              onClick={() => set({ period: p.value })}>
              {p.label}
            </button>
          ))}
        </div>
        {filters.period === "custom" && (
          <div className="dates">
            {filters.compare && page === "sales" && <span className="period-badge p1">Period 1</span>}
            <label>From <input type="date" value={filters.start} max={filters.end || undefined}
              onChange={(e) => set({ start: e.target.value })} /></label>
            <label>to <input type="date" value={filters.end} min={filters.start || undefined}
              onChange={(e) => set({ end: e.target.value })} /></label>
            {page === "sales" && (
              <button type="button" className={`compare-toggle${filters.compare ? " on" : ""}`} aria-pressed={filters.compare}
                onClick={() => set(filters.compare ? stopComparing(filters) : { compare: true, ...comparePeriods(filters) })}
                title="Compare with a second period, side by side">
                Compare
              </button>
            )}
          </div>
        )}
        {filters.period === "custom" && filters.compare && page === "sales" && (
          <div className="dates second">
            <span className="period-badge p2">Period 2</span>
            <label>From <input type="date" value={filters.start2} max={filters.end2 || undefined}
              onChange={(e) => set({ start2: e.target.value })} /></label>
            <label>to <input type="date" value={filters.end2} min={filters.start2 || undefined}
              onChange={(e) => set({ end2: e.target.value })} /></label>
          </div>
        )}

        <div className="segmented" role="group" aria-label="Company">
          {COMPANIES.map((c) => (
            <button key={c.value} type="button" className={filters.company === c.value ? "on" : ""}
              onClick={() => set({ company: c.value })}>
              {c.label}
            </button>
          ))}
        </div>

        {filters.region && (
          <button type="button" className="region-filter" onClick={() => set({ region: "" })}
            title="Region filter (chosen on the map). Click to go back to all regions.">
            Region: {regionLabel} <span aria-hidden="true">✕</span>
          </button>
        )}

        <div className="toggles">
          <Toggle label="Taxes included" checked={filters.tax} onChange={(v) => set({ tax: v })}
            title="By default, amounts are before taxes." />
        </div>
      </div>
    </header>
  );
}

/** Neutral app mark (no company logo): three bars. */
function Mark() {
  return (
    <svg className="logo" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="9" fill="var(--accent)" />
      <rect x="9" y="21" width="5" height="10" rx="1.5" fill="var(--on-accent)" />
      <rect x="17.5" y="15" width="5" height="16" rx="1.5" fill="var(--on-accent)" />
      <rect x="26" y="9" width="5" height="22" rx="1.5" fill="var(--on-accent)" />
    </svg>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  const flip = () => {
    const next = !dark;
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // private window: the choice lasts for this page only
    }
    setDark(next);
  };
  return (
    <button type="button" className="theme" onClick={flip} title={dark ? "Light theme" : "Dark theme"} aria-label={dark ? "Light theme" : "Dark theme"}>
      {dark ? "☀" : "☾"}
    </button>
  );
}

function Toggle({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Turning Compare off undoes turning it on: back to period 2's dates (the ones chosen before comparing). */
function stopComparing(f: Filters): Partial<Filters> {
  return { compare: false, start: f.start2 || f.start, end: f.end2 || f.end, start2: "", end2: "" };
}

/** Turning Compare on: the chosen dates become period 2 (on the right, where the change is shown) and period 1 is
 * the one just before, so the change reads "the recent period against the one before": whole months for whole
 * months (September → August), else the same number of days. */
function comparePeriods(f: Filters): Partial<Filters> {
  if (!f.start || !f.end) return {};
  const dayMs = 86400000;
  const iso = (d: Date) => d.toISOString().slice(0, 10); // dates are handled as UTC midnight
  const start = new Date(f.start);
  const end = new Date(f.end);
  const nextDay = new Date(end.getTime() + dayMs);
  if (start.getUTCDate() === 1 && nextDay.getUTCDate() === 1) {
    const months = (nextDay.getUTCFullYear() - start.getUTCFullYear()) * 12 + nextDay.getUTCMonth() - start.getUTCMonth();
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - months, 1));
    return { start: iso(first), end: iso(new Date(start.getTime() - dayMs)), start2: f.start, end2: f.end };
  }
  const days = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;
  return { start: iso(new Date(start.getTime() - days * dayMs)), end: iso(new Date(start.getTime() - dayMs)),
           start2: f.start, end2: f.end };
}
