// PowerPoint for the leadership meeting, built in the browser with native (editable) charts. From Compare: period 2
// (the recent one, the subject) against period 1 (the one before); otherwise: the period on screen, the same
// slides without the comparisons. Same filters and rules as the screen; USD and CAD are never added.
//
//   1. title · 2. at a glance (sales per company + invoices issued) · 3. sales by company (one chart per currency)
//   · [periods over 60 days: monthly sales, credit-note rate] · salesperson of the period (one per currency, on
//   sales) · sales map + top regions · questions.
//
// Style: navy title and closing slides, light content slides with a small blue overline and a big title, big
// numbers, few words.

import PptxGenJS from "pptxgenjs";
import { Filters, secondFilters } from "../api";
import { COMPANIES, Company, Currency } from "../demo/data";
import { addDays, monthEnd, monthStart, toDay } from "../demo/dates";
import { Options, Report, salespersonLines, setAsideLines } from "../demo/engine";
import { label as regionLabel } from "../demo/regions";
import { dataAsOf, engineReport, options } from "../demo/server";
import { heatmapPng } from "./heatmap";

const NAVY = "10295A";
const BLUE = "2160C4";
const BRIGHT = "5A93E0";
const PALE = "A9C4EC";
const ICE = "DDE7F5";
const PAGE = "F4F7FC";
const WHITE = "FFFFFF";
const INK = "0E1A33";
const MUTED = "5B6B82";
const RULE = "2A4A7F";
const UP = "1A7F37";
const DOWN = "C62828";
const ON_NAVY: Record<string, string> = { [UP]: "8FD19E", [DOWN]: "FF9A9A", [MUTED]: PALE };
const FONT = "Calibri";

const W = 13.333;
const H = 7.5;
const X0 = 0.8;
const CW = W - 2 * X0;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHLY_FROM_DAYS = 61;

// ------------------------------------------------------------------ labels and numbers

const ymd = (iso: string) => iso.split("-").map(Number) as [number, number, number];

/** "September 2026", "Q3 2026", "2026", "July – September 2026", else "Sep 3 – Oct 15, 2026". */
export function periodLabel(start: string, end: string): string {
  const [sy, sm, sd] = ymd(start);
  const [ey, em] = ymd(end);
  const whole = sd === 1 && end === monthEnd(end);
  const months = (ey - sy) * 12 + em - sm + 1;
  if (whole) {
    if (months === 1) return `${MONTHS[sm - 1]} ${sy}`;
    if (months === 3 && [1, 4, 7, 10].includes(sm)) return `Q${(sm - 1) / 3 + 1} ${sy}`;
    if (months === 12 && sm === 1) return String(sy);
    if (sy === ey) return `${MONTHS[sm - 1]} – ${MONTHS[em - 1]} ${ey}`;
    return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
  }
  const ed = ymd(end)[2];
  return `${SHORT[sm - 1]} ${sd}${sy !== ey ? `, ${sy}` : ""} – ${SHORT[em - 1]} ${ed}, ${ey}`;
}

function periodKind(start: string, end: string): string {
  const l = periodLabel(start, end);
  if (l.startsWith("Q")) return "of the quarter";
  if (/^\d+$/.test(l)) return "of the year";
  if (start.endsWith("-01") && toDay(end) - toDay(start) < 31 && !l.includes("–")) return "of the month";
  return "of the period";
}

const group = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (v: number, cur: string) => `${cur === "USD" ? "US$" : "$"}${group(v)}`.replace(/^(US)?\$-/, (m) => `−${m.replace("-", "")}`);
const moneyShort = (v: number, cur: string) =>
  Math.abs(v) >= 1_000_000 ? `${cur === "USD" ? "US$" : "$"}${(v / 1_000_000).toFixed(2)}M` : money(v, cur);
const pctText = (v: number) => `${(Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)).replace("-", "−")}%`;

function changeText(now: number, before: number, versus: string): [string, string] {
  if (!before) return [`nothing to compare in ${versus}`, MUTED];
  const c = ((now - before) / Math.abs(before)) * 100;
  const [arrow, color] = c > 0 ? ["▲ +", UP] : c < 0 ? ["▼ ", DOWN] : ["■ ", MUTED];
  return [`${arrow}${pctText(c)} vs ${versus}`, color];
}

const currencyTitle = (cur: string, scope: Company[]) =>
  `${cur} · ${scope.filter((c) => c.currency === cur).map((c) => c.short).join(" + ")}`;

// ------------------------------------------------------------------ figures from the engine's reports

type Person = { name: string; currency: Currency; sales: number; invoices: number };

/** Salespeople (not "Unassigned", not set-aside amounts) per currency. */
function people(r: Report): Map<string, Person> {
  const out = new Map<string, Person>();
  for (const l of salespersonLines(r)) {
    if (l.salesperson.kind === "unassigned") continue;
    const key = `${l.salesperson.name}|${l.currency}`;
    const p = out.get(key) ?? { name: l.salesperson.name, currency: l.currency, sales: 0, invoices: 0 };
    p.sales += l.sales;
    p.invoices += l.entries.filter((e) => e.kind === "sale").length;
    out.set(key, p);
  }
  return out;
}

function invoiceCount(r: Report): number {
  const lines = [...salespersonLines(r), ...(r.options.countSetAside ? setAsideLines(r) : [])];
  return lines.reduce((s, l) => s + l.entries.filter((e) => e.kind === "sale").length, 0);
}

const sales = (r: Report, code: string) => r.companyTotals.get(code)?.sales ?? 0;
const currencySales = (r: Report, comps: Company[], cur: string) =>
  comps.filter((c) => c.currency === cur).reduce((s, c) => s + sales(r, c.code), 0);

// ------------------------------------------------------------------ drawing helpers

type Run = { text: string; options?: PptxGenJS.TextPropsOptions };
type TextOpts = { size: number; color?: string; bold?: boolean; align?: "left" | "right" | "center"; valign?: "top" | "middle" | "bottom"; spacing?: number };

function text(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, content: string | Run[], o: TextOpts) {
  s.addText(content as string, {
    x, y, w, h, margin: 0, fontFace: FONT, fontSize: o.size, color: o.color ?? INK, bold: o.bold ?? false,
    align: o.align ?? "left", valign: o.valign ?? "top", charSpacing: o.spacing, fit: "none", wrap: true,
  });
}

/** Runs on several lines: each inner array is one line. */
function lines(rows: [string, Partial<{ size: number; color: string; bold: boolean }>][][]): Run[] {
  const out: Run[] = [];
  rows.forEach((row, i) => row.forEach(([t, o], j) => out.push({
    text: t, options: { fontSize: o.size, color: o.color, bold: o.bold, breakLine: j === row.length - 1 && i < rows.length - 1 },
  })));
  return out;
}

function rect(pptx: PptxGenJS, s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, color: string) {
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color }, line: { color, width: 0 } });
}

function header(s: PptxGenJS.Slide, overline: string, title: string) {
  text(s, X0, 0.55, CW, 0.3, overline.toUpperCase(), { size: 13, color: BLUE, bold: true, spacing: 2.5 });
  text(s, X0, 0.85, CW, 0.9, title, { size: 36, bold: true });
}

function barOptions(x: number, y: number, w: number, h: number, format: string, several: boolean): PptxGenJS.IChartOpts {
  return {
    x, y, w, h, barDir: "col", barGapWidthPct: 70, barGrouping: "clustered",
    chartColors: several ? [PALE, NAVY] : [NAVY],
    showValue: true, dataLabelFormatCode: format, dataLabelPosition: "outEnd", dataLabelFontSize: 12, dataLabelColor: INK,
    dataLabelFontFace: FONT, valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" },
    valAxisMinVal: 0, catAxisLabelFontSize: 13, catAxisLabelColor: INK, catAxisLabelFontFace: FONT, catAxisLineShow: true,
    catAxisLineColor: ICE, showLegend: several, legendPos: "t", legendFontSize: 12, legendFontFace: FONT, legendColor: MUTED,
  };
}

const numberFormat = (cur: string) => (cur === "USD" ? '"US$"#,##0' : '"$"#,##0');

// ------------------------------------------------------------------ monthly slides (periods over 60 days)

/** The calendar months the period touches, each cut to the period: [first day, last day, partial]. */
function monthSlices(start: string, end: string): [string, string, boolean][] {
  const out: [string, string, boolean][] = [];
  let first = monthStart(start);
  while (first <= end) {
    const last = monthEnd(first);
    const lo = first < start ? start : first;
    const hi = last > end ? end : last;
    out.push([lo, hi, lo !== first || hi !== last]);
    first = addDays(last, 1);
  }
  return out;
}

const monthLabel = (lo: string, partial: boolean) => `${SHORT[ymd(lo)[1] - 1]} ${String(ymd(lo)[0] % 100).padStart(2, "0")}${partial ? " (partial)" : ""}`;

function monthlySlides(pptx: PptxGenJS, overline: string, scope: Company[], base: Options,
                       months: [string, string, boolean, 0 | 1][], keys: [string, string][]) {
  const reports = months.map(([lo, hi]) => engineReport({ ...base, start: lo, end: hi }));
  const labels = months.map(([lo, , partial]) => monthLabel(lo, partial));
  const shade = months.map(([, , , which]) => (which === 0 ? PALE : NAVY));
  const labelsOn = months.length <= 13;
  for (const [title, kind] of [["Monthly sales", "sales"], ["Credit-note rate", "rate"]] as const) {
    const s = pptx.addSlide();
    s.background = { color: PAGE };
    header(s, overline, title);
    if (keys.length > 1) {
      text(s, X0, 1.2, CW, 0.3, keys.flatMap(([t, c]) => [{ text: "■ ", options: { color: c, fontSize: 14 } }, { text: `${t}    `, options: { color: MUTED } }]),
        { size: 12, align: "right" });
    }
    if (kind === "rate") text(s, X0, 1.62, CW, 0.3, "credit notes of the month ÷ sales of the month", { size: 12, color: MUTED });
    const top = 1.95, bottom = 7.05, gap = 0.12;
    const rowH = (bottom - top - gap * (scope.length - 1)) / Math.max(scope.length, 1);
    scope.forEach((c, i) => {
      const y = top + i * (rowH + gap);
      text(s, X0, y, 2.4, 0.5, lines([[[c.short, { bold: true }]], [[c.currency, { color: MUTED, size: 12 }]]]), { size: 15 });
      const opts = barOptions(X0 + 2.4, y, CW - 2.4, rowH, "", false);
      opts.showLegend = false;
      opts.showValue = labelsOn;
      opts.catAxisLabelFontSize = months.length > 8 ? 10 : 12;
      opts.dataLabelFontSize = months.length > 6 ? 10 : 12;
      if (!labelsOn) {
        opts.valAxisHidden = false;
        opts.valAxisLabelFontSize = 10;
        opts.valGridLine = { color: ICE, style: "solid", size: 0.75 };
      }
      if (kind === "sales") {
        opts.barGapWidthPct = 40;
        opts.chartColors = shade.every((x) => x === NAVY) ? [NAVY] : shade;
        opts.dataLabelFormatCode = months.length <= 8 ? numberFormat(c.currency) : c.currency === "USD" ? '"US$"#,##0,"k"' : '"$"#,##0,"k"';
        opts.valAxisLabelFormatCode = opts.dataLabelFormatCode;
        s.addChart(pptx.ChartType.bar, [{ name: title, labels, values: reports.map((r) => sales(r, c.code)) }], opts);
      } else {
        const rate = (r: Report) => {
          const t = r.companyTotals.get(c.code);
          return t && t.sales ? (t.credits / t.sales) * 100 : null;
        };
        // Compare: period 1's points pale, period 2's navy (two series, each blank outside its own months).
        const series = keys.length > 1
          ? ([0, 1] as const).map((w) => ({ name: keys[w][0], labels, values: reports.map((r, j) => (months[j][3] === w ? rate(r) : null)) }))
          : [{ name: title, labels, values: reports.map(rate) }];
        s.addChart(pptx.ChartType.line, series as PptxGenJS.OptsChartData[], {
          ...opts, chartColors: keys.length > 1 ? [PALE, BLUE] : [BLUE], lineSize: 2.25, lineDataSymbol: "circle",
          lineDataSymbolSize: 7, dataLabelPosition: "t", dataLabelFormatCode: '0.0"%"', valAxisLabelFormatCode: '0"%"',
          displayBlanksAs: "gap",
        });
      }
    });
  }
}

// ------------------------------------------------------------------ the deck

export async function downloadDeck(filters: Filters, compare: boolean, presenter: string): Promise<void> {
  // Compare: period 1 = start/end (before), period 2 = start2/end2 (the subject). Otherwise the one period.
  const first = compare ? engineReport(filters) : null;
  const second = engineReport(compare ? secondFilters(filters) : filters);
  const o2 = second.options;
  const scope = COMPANIES.filter((c) => o2.company === null || c.code === o2.company);
  const currencies = (["CAD", "USD"] as const).filter((cur) => scope.some((c) => c.currency === cur));
  const label2 = periodLabel(o2.start, o2.end);
  const label1 = first ? periodLabel(first.options.start, first.options.end) : "";
  const versus = (now: number, before: number): [string, string] => (first ? changeText(now, before, label1) : ["", MUTED]);
  const overline = `Sales | ${label2}`;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.title = `Sales · ${label2}`;
  pptx.author = presenter || "Sales Dashboard";
  pptx.company = "Demo (fictional data)";

  // 1. Title
  let s = pptx.addSlide();
  s.background = { color: NAVY };
  rect(pptx, s, X0, 0.82, 0.18, 0.18, BRIGHT);
  text(s, X0 + 0.38, 0.74, 8, 0.4, "LEADERSHIP MEETING · SALES", { size: 15, color: PALE, spacing: 3 });
  text(s, W - X0 - 2.4, 0.62, 2.4, 0.62, lines([[["HALDEN", { bold: true, color: WHITE, size: 15 }]], [["DEMO · FICTIONAL DATA", { color: PALE, size: 10 }]]]),
    { size: 15, align: "right" });
  text(s, X0, 2.55, CW, 0.6, "Sales review", { size: 26, color: BRIGHT, bold: true });
  text(s, X0, 3.2, CW, 1.3, label2, { size: 66, color: WHITE, bold: true });
  if (first) text(s, X0, 4.55, CW, 0.7, `compared with ${label1}`, { size: 32, color: PALE });
  rect(pptx, s, X0, 6.3, CW, 0.01, RULE);
  text(s, X0, 6.5, 6, 0.4, presenter, { size: 18, color: WHITE });
  text(s, W - X0 - 6, 6.5, 6, 0.4, scope.map((c) => c.short).join(" · "), { size: 15, color: PALE, align: "right" });

  // 2. At a glance: sales per company and invoices issued, each against period 1 when comparing
  s = pptx.addSlide();
  s.background = { color: PAGE };
  header(s, overline, `${label2} at a glance`);
  const cards: [string, string, [string, string], string][] = scope.map((c) => [
    c.name, moneyShort(sales(second, c.code), c.currency), versus(sales(second, c.code), first ? sales(first, c.code) : 0),
    o2.includeTax ? "sales, taxes included" : "sales, before taxes",
  ]);
  const n1 = first ? invoiceCount(first) : 0;
  const n2 = invoiceCount(second);
  cards.push(["Invoices issued", group(n2), versus(n2, n1), o2.company === null ? "all companies" : scope[0].short]);
  const gap = 0.35;
  const cw = (CW - gap * (cards.length - 1)) / cards.length;
  const bars = [NAVY, BLUE, BRIGHT, PALE];
  const pad = 0.3;
  const inner = cw - 2 * pad;
  // Every figure on one line at the same size: the longest sets it (~0.52 em per character, Calibri bold).
  const size = Math.min(44, Math.floor((inner * 72) / (0.52 * Math.max(...cards.map((c) => c[1].length)))));
  cards.forEach(([title, big, [ch, chColor], caption], i) => {
    const x = X0 + i * (cw + gap);
    const top = 2.15;
    rect(pptx, s, x, top, cw, 4.6, WHITE);
    rect(pptx, s, x, top, cw, 0.06, bars[i % bars.length]);
    text(s, x + pad, top + 0.4, inner, 0.7, title, { size: 17, color: MUTED });
    text(s, x + pad, top + 1.9, inner, 1.2, big, { size, color: i % 2 === 0 ? NAVY : BLUE, bold: true, valign: "bottom" });
    if (first) text(s, x + pad, top + 3.25, inner, 0.6, ch, { size: 14, color: chColor, bold: true });
    text(s, x + pad, top + (first ? 3.95 : 3.3), inner, 0.4, caption, { size: 13, color: MUTED });
  });

  // 3. Sales by company, period 1 vs period 2 when comparing (one chart per currency: never added together)
  s = pptx.addSlide();
  s.background = { color: PAGE };
  header(s, overline, "Sales by company");
  const units = currencies.map((cur) => scope.filter((c) => c.currency === cur).length);
  const totalUnits = units.reduce((a, b) => a + b, 0) || 1;
  let x = X0;
  currencies.forEach((cur, i) => {
    const w = ((CW - 0.5 * (currencies.length - 1)) * units[i]) / totalUnits;
    const comps = scope.filter((c) => c.currency === cur);
    text(s, x, 1.95, w, 0.35, currencyTitle(cur, scope), { size: 14, color: BLUE, bold: true });
    const data = [...(first ? [[label1, first] as const] : []), [label2, second] as const].map(([name, r]) => ({
      name, labels: comps.map((c) => c.short), values: comps.map((c) => sales(r, c.code)),
    }));
    s.addChart(pptx.ChartType.bar, data, barOptions(x, 2.35, w, 3.75, numberFormat(cur), !!first));
    const rate = (r: Report) => {
      const sl = currencySales(r, comps, cur);
      const cr = comps.reduce((acc, c) => acc + (r.companyTotals.get(c.code)?.credits ?? 0), 0);
      return sl ? pctText((cr / sl) * 100) : "—";
    };
    text(s, x, 6.2, w, 0.7, lines([
      [["Credit notes: ", { color: MUTED }], [`${rate(second)} of sales`, { bold: true }]],
      ...(first ? [[[`${label1}: ${rate(first)}`, { color: MUTED, size: 13 }]] as [string, Partial<{ size: number; color: string; bold: boolean }>][]] : []),
    ]), { size: 14 });
    x += w + 0.5;
  });

  // Over 60 days: monthly sales and credit-note rate, like the KPI page
  if (toDay(o2.end) - toDay(o2.start) + 1 >= MONTHLY_FROM_DAYS) {
    let months: [string, string, boolean, 0 | 1][] = monthSlices(o2.start, o2.end).map(([lo, hi, p]) => [lo, hi, p, 1]);
    let keys: [string, string][] = [[label2, NAVY]];
    if (first) {
      months = [...monthSlices(first.options.start, first.options.end).map(([lo, hi, p]) => [lo, hi, p, 0] as [string, string, boolean, 0 | 1]), ...months];
      keys = [[label1, PALE], ...keys];
    }
    monthlySlides(pptx, overline, scope, options(compare ? secondFilters(filters) : filters), months, keys);
  }

  // Salesperson of the period: the most sales, one per currency (no conversion)
  const p1 = first ? people(first) : new Map<string, Person>();
  const p2 = people(second);
  s = pptx.addSlide();
  s.background = { color: PAGE };
  header(s, overline, `Salesperson ${periodKind(o2.start, o2.end)}`);
  const winners = currencies.flatMap((cur) => {
    const best = [...p2.values()].filter((p) => p.currency === cur && p.sales > 0).sort((a, b) => b.sales - a.sales)[0];
    return best ? [best] : [];
  });
  if (!winners.length) text(s, X0, 2.6, CW, 0.5, `No sales in ${label2}.`, { size: 18, color: MUTED });
  const ww = Math.min((CW - 0.5 * (winners.length - 1)) / Math.max(winners.length, 1), 6.5);
  winners.forEach((p, i) => {
    const xx = X0 + i * (ww + 0.5);
    const top = 2.1;
    const dark = i === 0;
    const [fg, soft] = dark ? [WHITE, PALE] : [INK, MUTED];
    rect(pptx, s, xx, top, ww, 4.75, dark ? NAVY : WHITE);
    const pd = 0.5;
    text(s, xx + pd, top + 0.45, ww - 2 * pd, 0.4, currencyTitle(p.currency, scope).toUpperCase(), { size: 13, color: soft, bold: true, spacing: 2 });
    text(s, xx + pd, top + 0.85, ww - 2 * pd, 1.25, p.name, { size: p.name.length <= 18 ? 36 : 30, color: fg, bold: true, valign: "bottom" });
    text(s, xx + pd, top + 2.25, ww - 2 * pd, 0.7, money(p.sales, p.currency), { size: 32, color: dark ? WHITE : BLUE, bold: true });
    text(s, xx + pd, top + 2.9, ww - 2 * pd, 0.4, `in sales, ${o2.includeTax ? "taxes included" : "before taxes"}`, { size: 14, color: soft });
    rect(pptx, s, xx + pd, top + 3.4, ww - 2 * pd, 0.01, dark ? RULE : ICE);
    const total = currencySales(second, scope, p.currency);
    const before = p1.get(`${p.name}|${p.currency}`)?.sales ?? 0;
    const [ch, chColor] = versus(p.sales, before);
    text(s, xx + pd, top + 3.6, ww - 2 * pd, 1.0, lines([
      [[`${total ? pctText((p.sales / total) * 100) : "—"} `, { bold: true, color: fg }], [`of ${p.currency} sales`, { color: soft }]],
      [[`${group(p.invoices)} `, { bold: true, color: fg }], [`invoice${p.invoices === 1 ? "" : "s"}`, { color: soft }]],
      ...(ch ? [[[ch, { bold: true, color: dark ? ON_NAVY[chColor] ?? chColor : chColor }]] as [string, Partial<{ size: number; color: string; bold: boolean }>][]] : []),
    ]), { size: 16 });
  });

  // Sales map of period 2 + the top regions per currency
  s = pptx.addSlide();
  s.background = { color: PAGE };
  header(s, overline, "Sales map");
  const map = await heatmapPng(second.regionSales);
  const mapW = 7.9;
  s.addImage({ data: map.data, x: X0, y: 1.95, w: mapW, h: mapW / map.aspect });
  const sideX = X0 + mapW + 0.45;
  const sideW = W - X0 - sideX;
  let y = 2.0;
  for (const cur of currencies) {
    const rows = [...second.regionSales].filter(([code, v]) => code && !code.startsWith("W-") && (v[cur] ?? 0) > 0)
      .map(([code, v]) => [code!, v[cur]!] as const).sort((a, b) => b[1] - a[1]).slice(0, 5);
    text(s, sideX, y, sideW, 0.3, `Top regions · ${currencyTitle(cur, scope)}`, { size: 13, color: cur === "CAD" ? "1C5CAB" : "B83230", bold: true });
    y += 0.38;
    if (!rows.length) {
      text(s, sideX, y, sideW, 0.3, "—", { size: 13, color: MUTED });
      y += 0.3;
    }
    for (const [code, v] of rows) {
      text(s, sideX, y, sideW, 0.3, regionLabel(code), { size: 13 });
      text(s, sideX, y, sideW, 0.3, moneyShort(v, cur), { size: 13, bold: true, align: "right" });
      y += 0.3;
    }
    y += 0.22;
  }
  const world: Partial<Record<Currency, number>> = {};
  let countries = 0;
  for (const [code, v] of second.regionSales) {
    if (code?.startsWith("W-") && Object.values(v).some((n) => (n ?? 0) > 0)) {
      countries++;
      for (const [cur, n] of Object.entries(v)) world[cur as Currency] = (world[cur as Currency] ?? 0) + (n ?? 0);
    }
  }
  if (countries) {
    const amounts = (["CAD", "USD"] as const).filter((c) => world[c]).map((c) => moneyShort(world[c]!, c)).join(" + ");
    text(s, sideX, y, sideW, 0.55, lines([[["Rest of the world", { bold: true, color: "2E8B2E" }]], [[`${amounts} · ${countries} countr${countries === 1 ? "y" : "ies"}`, {}]]]), { size: 13 });
  }
  text(s, sideX, 6.55, sideW, 0.4, "Darker = more sales (per currency, nothing converted).", { size: 11, color: MUTED });

  // Questions
  s = pptx.addSlide();
  s.background = { color: NAVY };
  rect(pptx, s, X0, 0.68, 0.18, 0.18, BRIGHT);
  text(s, X0 + 0.38, 0.6, 8, 0.4, `SALES KPIs · ${label2.toUpperCase()}`, { size: 15, color: PALE, spacing: 3 });
  text(s, X0, 2.6, CW, 1.6, "Questions and discussion", { size: 66, color: WHITE, bold: true, valign: "middle" });
  rect(pptx, s, X0, 6.3, CW, 0.01, RULE);
  text(s, X0, 6.5, 6, 0.4, presenter, { size: 18, color: WHITE });
  text(s, W - X0 - 6, 6.5, 6, 0.4, `Demo data as of ${dataAsOf().slice(0, 10)}`, { size: 12, color: PALE, align: "right" });

  await pptx.writeFile({ fileName: `sales-presentation_${o2.start}_${o2.end}.pptx` });
}
