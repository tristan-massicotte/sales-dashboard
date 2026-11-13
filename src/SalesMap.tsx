import maplibregl, { ExpressionSpecification, GeoJSONSource, Map as MlMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { FxAverage, RegionNet } from "./api";
import { currencyLabel, day, money, pct } from "./format";

// Heat map of SALES by province/state (shipping address, else billing). Both currencies at once, never added:
// CAD (Canada + Medical) in blue, USD (Inc.) in red, each on its own scale. A region with both is coloured in its
// own country's currency; the tooltip and the list show both. Outside Canada and the US, by country ("W-ES") in
// green. Globe projection; the first time per session it flies to North America (~1 s, skippable with a click or
// a key). Boundaries: Natural Earth (public domain), bundled in public/geo.

export const UNKNOWN = "unknown";

// Sequential ramps, each validated as an ordinal ramp against each theme's surface (dataviz validator);
// blue vs red also validated for colour-blind separation. Light: low → high = light → dark; dark: reversed.
const RAMPS = {
  CAD: {
    light: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"],
    dark: ["#1c5cab", "#2a78d6", "#5598e7", "#9ec5f4", "#cde2fb"],
  },
  USD: {
    light: ["#ee9897", "#e8706f", "#e34948", "#b83230", "#7f1d1c"],
    dark: ["#9a2b2a", "#c73f3e", "#e66767", "#f09a99", "#f8c9c8"],
  },
  // Rest of the world. Green vs red is weak for red-green colour blindness (validator); acceptable here
  // because green countries never touch red states and every country is named in the tooltip and list.
  WORLD: {
    light: ["#6abf6a", "#45a845", "#2e8b2e", "#1d6b1d", "#0d470d"],
    dark: ["#1d6b1d", "#2e8b2e", "#4caf50", "#8fd18f", "#c4e8c4"],
  },
};
type Scale = keyof typeof RAMPS;
const isWorld = (code: string) => code.startsWith("W-");
const CURRENCIES = ["CAD", "USD"] as const;
type Currency = (typeof CURRENCIES)[number];
const COLORS = {
  light: { land: "#e8eaed", noData: "#d5d9de", border: "#ffffff", landLine: "#c9ced4", ocean: "#cfd9e6", negative: "#3f444b", outline: "#1d2125" },
  dark: { land: "#2a2f36", noData: "#363c45", border: "#15181c", landLine: "#3c434c", ocean: "#141a24", negative: "#0b0d10", outline: "#e4e7eb" },
};
type Theme = keyof typeof COLORS;

// Camera that frames Canada + the continental US.
const NORTH_AMERICA: [[number, number], [number, number]] = [[-135, 22], [-55, 62]];
const INTRO_KEY = "introPlayed";
// Bump when frontend/public/geo changes: the files keep their names, so browsers could keep an old copy
// (Safari once kept a stale countries.json).
const GEO_VERSION = "3";
const GEO = `${import.meta.env.BASE_URL}geo`;

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function ramp(scale: Scale, theme: Theme): ExpressionSpecification {
  return ["interpolate", ["linear"], ["feature-state", "t"],
    ...RAMPS[scale][theme].flatMap((color, i, all) => [i / (all.length - 1), color])] as unknown as ExpressionSpecification;
}

/** Countries: green where there are sales, plain land elsewhere (Canada and the US are under the regions). */
function landColor(theme: Theme): ExpressionSpecification {
  const c = COLORS[theme];
  return [
    "case",
    ["==", ["coalesce", ["feature-state", "t"], -1], -1], c.land,
    ["==", ["feature-state", "t"], -2], c.negative,
    ramp("WORLD", theme),
  ] as ExpressionSpecification;
}

function fillColor(theme: Theme): ExpressionSpecification {
  const c = COLORS[theme];
  // feature-state t: 0..1 scaled net, -2 negative net, absent = no sales; cur: the currency coloured.
  return [
    "case",
    ["==", ["coalesce", ["feature-state", "t"], -1], -1], c.noData,
    ["==", ["feature-state", "t"], -2], c.negative,
    ["==", ["feature-state", "cur"], "USD"], ramp("USD", theme),
    ramp("CAD", theme),
  ] as ExpressionSpecification;
}

/** The currency a region is coloured in: the only one it has, else its own country's. */
function shownCurrency(r: RegionNet): Currency | null {
  const has = CURRENCIES.filter((c) => (r.sales[c] ?? 0) !== 0);
  if (has.length <= 1) return has[0] ?? null;
  return r.code.startsWith("US-") ? "USD" : "CAD";
}

function style(theme: Theme): StyleSpecification {
  const c = COLORS[theme];
  return {
    version: 8,
    projection: { type: "globe" },
    sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] },
    sources: {
      countries: { type: "geojson", data: `${GEO}/countries.json?v=${GEO_VERSION}`, promoteId: "code" },
      regions: { type: "geojson", data: `${GEO}/regions.json?v=${GEO_VERSION}`, promoteId: "code" },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": c.ocean } },
      { id: "land", type: "fill", source: "countries", paint: { "fill-color": landColor(theme) } },
      { id: "land-line", type: "line", source: "countries", paint: { "line-color": c.landLine, "line-width": 0.5 } },
      {
        id: "land-focus", type: "line", source: "countries",
        paint: {
          "line-color": c.outline,
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, ["boolean", ["feature-state", "hover"], false], 1.5, 0],
        },
      },
      { id: "regions-fill", type: "fill", source: "regions", paint: { "fill-color": fillColor(theme) } },
      { id: "regions-line", type: "line", source: "regions", paint: { "line-color": c.border, "line-width": 0.8 } },
      {
        id: "regions-focus", type: "line", source: "regions",
        paint: {
          "line-color": c.outline,
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, ["boolean", ["feature-state", "hover"], false], 1.5, 0],
        },
      },
    ],
  };
}

/** Square root, so small regions still show next to a very large one; the legend says so. */
function scaled(net: number, max: number): number {
  return max > 0 ? Math.sqrt(net / max) : 0;
}

type Props = {
  regions: RegionNet[];
  fx: FxAverage | null;
  selected: string; // region code, UNKNOWN, or ""
  onSelect: (code: string) => void;
};

export function SalesMap({ regions, fx, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [drawn, setDrawn] = useState(false); // hidden until first fully drawn (no blank globe)
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [hover, setHover] = useState<{ code: string; name: string; x: number; y: number } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const values = useMemo(() => {
    const byCode = new Map<string, RegionNet>();
    for (const r of regions) byCode.set(r.code, r);
    const home = regions.filter((r) => r.code !== UNKNOWN && !isWorld(r.code));
    const world = regions.filter((r) => isWorld(r.code));
    const maxOf = (rs: RegionNet[]) =>
      Object.fromEntries(CURRENCIES.map((c) => [c, Math.max(0, ...rs.map((r) => r.sales[c] ?? 0))])) as Record<Currency, number>;
    const has = (rs: RegionNet[]) => CURRENCIES.filter((c) => rs.some((r) => (r.sales[c] ?? 0) !== 0));
    // Currencies with something to show in Canada/US (the company filter can leave only one), and abroad.
    return { byCode, max: maxOf(home), worldMax: maxOf(world), present: has(home), worldPresent: has(world) };
  }, [regions]);

  // Create the map once.
  useEffect(() => {
    const el = container.current!;
    const intro = !sessionStorage.getItem(INTRO_KEY) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const map = new maplibregl.Map({
      container: el,
      style: style(currentTheme()),
      center: intro ? [-30, 20] : [-95, 45],
      zoom: intro ? 0.6 : 2,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      scrollZoom: false, // the page scrolls; zoom with the buttons or a double-click
      renderWorldCopies: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    const settle = () => map.fitBounds(NORTH_AMERICA, { padding: 16, animate: false });
    let skip: (() => void) | null = null;
    map.once("idle", () => setDrawn(true));
    map.on("load", () => {
      setReady(true);
      if (!intro) settle();
    });
    // The intro starts once the globe is drawn (land and regions loaded), not on a blank sphere.
    if (intro) map.once("idle", () => {
      try {
        sessionStorage.setItem(INTRO_KEY, "1");
      } catch {
        // private window: the intro may play again
      }
      const camera = map.cameraForBounds(NORTH_AMERICA, { padding: 16 });
      if (!camera) return settle();
      map.flyTo({ ...camera, duration: 1100, curve: 1.2, essential: false });
      skip = () => {
        map.stop();
        settle();
        cleanup();
      };
      const cleanup = () => {
        el.removeEventListener("pointerdown", skip!);
        window.removeEventListener("keydown", skip!);
      };
      el.addEventListener("pointerdown", skip, { once: true });
      window.addEventListener("keydown", skip, { once: true });
      map.once("moveend", cleanup);
    });

    // Hover and click: a province/state, else a country with sales (Canada and the US are covered by
    // their regions). Feature ids are the region codes; countries are "W-ES".
    let hovered: { source: string; id: string } | null = null;
    const setHovered = (next: { source: string; id: string } | null) => {
      if (hovered) map.setFeatureState(hovered, { hover: false });
      hovered = next;
      if (next) map.setFeatureState(next, { hover: true });
    };
    const pick = (point: maplibregl.Point) => {
      const region = map.queryRenderedFeatures(point, { layers: ["regions-fill"] })[0];
      if (region) return { source: "regions", id: String(region.properties.code), name: String(region.properties.name) };
      const country = map.queryRenderedFeatures(point, { layers: ["land"] })[0];
      const code = country ? String(country.properties.code) : "";
      if (country && map.getFeatureState({ source: "countries", id: code }).t !== undefined) {
        return { source: "countries", id: code, name: String(country.properties.name) };
      }
      return null;
    };
    map.on("mousemove", (e) => {
      const f = pick(e.point);
      if (f?.id !== hovered?.id) setHovered(f && { source: f.source, id: f.id });
      map.getCanvas().style.cursor = f ? "pointer" : "";
      setHover(f ? { code: f.id, name: f.name, x: e.point.x, y: e.point.y } : null);
    });
    map.on("mouseout", () => {
      setHovered(null);
      setHover(null);
    });
    map.on("click", (e) => {
      const f = pick(e.point);
      if (f) onSelectRef.current(f.id);
    });

    // Follow the light/dark toggle.
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(el);
    return () => {
      observer.disconnect();
      resize.disconnect();
      if (skip) {
        el.removeEventListener("pointerdown", skip);
        window.removeEventListener("keydown", skip);
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Theme colors.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const c = COLORS[theme];
    map.setPaintProperty("ocean", "background-color", c.ocean);
    map.setPaintProperty("land", "fill-color", landColor(theme));
    map.setPaintProperty("land-focus", "line-color", c.outline);
    map.setPaintProperty("land-line", "line-color", c.landLine);
    map.setPaintProperty("regions-fill", "fill-color", fillColor(theme));
    map.setPaintProperty("regions-line", "line-color", c.border);
    map.setPaintProperty("regions-focus", "line-color", c.outline);
  }, [theme, ready]);

  // Values and selection → feature states.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const apply = () => {
      map.removeFeatureState({ source: "regions" });
      map.removeFeatureState({ source: "countries" });
      for (const r of regions) {
        if (r.code === UNKNOWN) continue;
        const cur = shownCurrency(r);
        if (!cur) continue;
        const sales = r.sales[cur];
        const world = isWorld(r.code);
        const t = sales < 0 ? -2 : scaled(sales, (world ? values.worldMax : values.max)[cur]);
        map.setFeatureState({ source: world ? "countries" : "regions", id: r.code }, { cur, t });
      }
      if (selected && selected !== UNKNOWN) {
        map.setFeatureState({ source: isWorld(selected) ? "countries" : "regions", id: selected }, { selected: true });
      }
    };
    const source = map.getSource("regions") as GeoJSONSource | undefined;
    if (source && map.isSourceLoaded("regions") && map.isSourceLoaded("countries")) apply();
    else map.once("idle", apply);
  }, [regions, selected, ready, values]);

  const hovered = hover ? values.byCode.get(hover.code) : undefined;

  return (
    <>
    <section className="card map-card">
      <div className="map-wrap">
        <div ref={container} className={`map ${drawn ? "drawn" : ""}`} role="img" aria-label="Map of sales by province, state and country" />
        {!drawn && <div className="map-loading">Loading the map…</div>}
        {hover && (
          <div className="map-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            <strong>{hover.name}</strong>
            {hovered && Object.keys(hovered.sales).length > 0 ? (
              <>
                {Object.entries(hovered.sales).map(([cur, v]) => (
                  <div key={cur}>Sales {money(v, cur)}</div>
                ))}
              </>
            ) : (
              <div className="muted">No sales</div>
            )}
          </div>
        )}
      </div>

      <aside className="map-side">
        <h2>Sales by region</h2>
        <div className="legend" aria-hidden="true">
          {values.present.map((cur) => (
            <LegendRow key={cur} title={cur === "CAD" ? "Canada + Medical" : "Inc."} currency={cur} scale={cur}
              max={values.max[cur]} theme={theme} />
          ))}
          {values.worldPresent.map((cur) => (
            <LegendRow key={`W${cur}`} title="Rest of the world" currency={cur} scale="WORLD" max={values.worldMax[cur]} theme={theme} />
          ))}
          <div className="legend-keys">
            <span><i style={{ background: COLORS[theme].noData }} /> No sales</span>
          </div>
        </div>
        <p className="muted small">
          By the invoice's shipping address (else its billing address). Sales through distributors show at the
          distributor's address. Click a region to see its salespeople.
        </p>
      </aside>
    </section>

    <section className="card breakdown">
      <h2>Sales breakdown</h2>
      <div className="breakdown-cols">
        {values.present.map((cur) => (
          <RegionList key={cur} title={cur === "CAD" ? "Canada + Medical" : "Inc."} subtitle={currencyLabel(cur)} scale={cur}
            selected={selected} onSelect={onSelect} approx={!!fx}
            rows={regions.filter((r) => r.code !== UNKNOWN && !isWorld(r.code) && (r.sales[cur] ?? 0) !== 0)
              .map((r) => ({ code: r.code, label: r.label, value: r.sales[cur], currency: cur, share: shareOf(r, cur) }))} />
        ))}
        {values.worldPresent.length > 0 && (
          <RegionList title="Rest of the world" subtitle="by country" scale="WORLD" selected={selected} onSelect={onSelect} approx={!!fx}
            rows={regions.filter((r) => isWorld(r.code)).flatMap((r) =>
              Object.entries(r.sales).filter(([, v]) => v !== 0).map(([cur, v]) => ({ code: r.code, label: r.label, value: v, currency: cur, share: shareOf(r, cur) })))} />
        )}
      </div>
      {Object.entries(values.byCode.get(UNKNOWN)?.sales ?? {}).filter(([, v]) => v !== 0).map(([cur, v]) => (
        <button key={cur} type="button" className={`unknown ${selected === UNKNOWN ? "on" : ""}`} onClick={() => onSelect(UNKNOWN)}
          title="Invoices without a recognized address (shipping or billing)">
          <span>Unknown region</span>
          <span className="num">{money(v, cur)}</span>
          <span className="num share">{shareText(values.byCode.get(UNKNOWN)!.share_pct, !!fx)}</span>
        </button>
      ))}
      {values.present.length + values.worldPresent.length === 0 && <p className="muted">No sales in the period.</p>}
      {fx && (
        <p className="fx-note">
          <strong>Approximate %.</strong> To compute each region's share of the total, USD sales are converted at
          the average {fx.source} from {day(fx.first)} to {day(fx.last)}
          {" "}({fx.days} business day{fx.days > 1 ? "s" : ""}):
          {" "}<strong>1 USD = {fx.usd_cad.toLocaleString("en-CA", { minimumFractionDigits: 4 })} CAD</strong>.
          (Production uses the Bank of Canada's daily rates.) The amounts shown are never converted.
        </p>
      )}
    </section>
    </>
  );
}

/** A region's share, attributed to one of its currencies (a region in both lists shows it once). */
function shareOf(r: RegionNet, cur: string): number | null {
  const main = Object.entries(r.sales).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  return cur === main ? r.share_pct : null;
}

function shareText(share: number | null, approx: boolean): string {
  return share === null ? "" : `${approx ? "≈ " : ""}${pct(share)}`;
}

function LegendRow({ title, currency, scale, max, theme }: { title: string; currency: string; scale: Scale; max: number; theme: Theme }) {
  const short = (v: number) => money(Math.round(v), currency).replace(".00", "");
  return (
    <div className="legend-row">
      <div className="legend-title">{title} <span className="muted">({currencyLabel(currency)})</span></div>
      <div className="legend-bar" style={{ background: `linear-gradient(to right, ${RAMPS[scale][theme].join(", ")})` }} />
      <div className="legend-labels"><span>{short(0)}</span><span>{short(max / 4)}</span><span>{short(max)}</span></div>
    </div>
  );
}

type Row = { code: string; label: string; value: number; currency: string; share: number | null };

/** Ranked list below the map: each region's sales and its share of total sales. */
function RegionList({ title, subtitle, scale, rows, selected, onSelect, approx }: {
  title: string; subtitle: string; scale: Scale; rows: Row[]; selected: string; onSelect: (code: string) => void; approx: boolean;
}) {
  const sorted = [...rows].sort((a, b) => a.currency.localeCompare(b.currency) || b.value - a.value);
  return (
    <section>
      <h3 className={`list-head ${scale}`}>{title} <span className="muted">· {subtitle}</span></h3>
      <ol className="region-list">
        {sorted.map((r) => (
          <li key={`${r.code}-${r.currency}`} className={r.code === selected ? "on" : ""}>
            <button type="button" onClick={() => onSelect(r.code)}>
              <span>{r.label}</span>
              <span className="num">{money(r.value, r.currency)}</span>
              <span className="num share">{shareText(r.share, approx)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
