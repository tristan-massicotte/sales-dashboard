import { ReactNode, useState } from "react";

// Small SVG charts for the KPI page (no library). Thin bars with rounded tops, recessive grid, a hover
// tooltip on every mark (whole column is the hit area), values in text tokens, series colour from the
// currency (CSS var). The SVG keeps its aspect ratio and scales with its container.

const W = 600;
const PAD = { top: 10, right: 8, bottom: 22, left: 52 };

const compact = new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 });
export const short = (v: number) => compact.format(v);

type Tip = { x: number; y: number; lines: ReactNode[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: `${tip.x}%`, top: tip.y }}>
      {tip.lines.map((l, i) => <div key={i} className={i === 0 ? "strong" : ""}>{l}</div>)}
    </div>
  );
}

type Props = {
  values: (number | null)[];
  labels: string[];
  partial?: boolean[]; // month in progress: lighter bar
  color: string; // CSS colour (var)
  height?: number;
  max?: number; // shared scale (small multiples)
  axis?: boolean;
  format?: (v: number) => string;
  tips: ReactNode[][]; // tooltip lines per column
};

export function BarChart({ values, labels, partial = [], color, height = 170, max, axis = true, format = short, tips }: Props) {
  const [tip, setTip] = useState<Tip>(null);
  const left = axis ? PAD.left : 4;
  const bottom = axis ? PAD.bottom : 4;
  const top = max ?? Math.max(0, ...values.map((v) => v ?? 0));
  const plotH = height - PAD.top - bottom;
  const step = (W - left - PAD.right) / Math.max(1, values.length);
  const barW = Math.max(2, Math.min(28, step * 0.62));
  const y = (v: number) => PAD.top + plotH - (top > 0 ? (Math.max(0, v) / top) * plotH : 0);
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img">
        {axis && [0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W - PAD.right} y1={y(top * f)} y2={y(top * f)} className="grid" />
            <text x={left - 6} y={y(top * f) + 4} className="tick" textAnchor="end">{format(top * f)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const x = left + i * step + (step - barW) / 2;
          const h = v && v > 0 ? PAD.top + plotH - y(v) : 0;
          return (
            <g key={i}>
              {h > 0 && (
                <path d={roundedTop(x, y(v!), barW, h)} fill={color} opacity={partial[i] ? 0.45 : 1} />
              )}
              {axis && <text x={x + barW / 2} y={height - 6} className="tick" textAnchor="middle">{labels[i]}</text>}
              <rect x={left + i * step} y={0} width={step} height={height} fill="transparent"
                onMouseEnter={() => setTip({ x: ((left + (i + 0.5) * step) / W) * 100, y: 4, lines: tips[i] })} />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Rate over time (e.g. credit notes % of sales): a 2px line with dots; gaps where there is no value. */
export function LineChart({ values, labels, color, height = 150, format, tips }: Omit<Props, "partial" | "max" | "axis"> & { format: (v: number) => string }) {
  const [tip, setTip] = useState<Tip>(null);
  const top = Math.max(1, ...values.map((v) => v ?? 0)) * 1.15;
  const plotH = height - PAD.top - PAD.bottom;
  const step = (W - PAD.left - PAD.right) / Math.max(1, values.length);
  const x = (i: number) => PAD.left + (i + 0.5) * step;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const segments: string[] = [];
  let current = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = "";
    } else current += `${current ? "L" : "M"}${x(i)},${y(v)}`;
  });
  if (current) segments.push(current);
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(top * f)} y2={y(top * f)} className="grid" />
            <text x={PAD.left - 6} y={y(top * f) + 4} className="tick" textAnchor="end">{format(top * f)}</text>
          </g>
        ))}
        {segments.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} />)}
        {values.map((v, i) => (
          <g key={i}>
            {v !== null && <circle cx={x(i)} cy={y(v)} r={4} fill={color} className="dot" />}
            <text x={x(i)} y={height - 6} className="tick" textAnchor="middle">{labels[i]}</text>
            <rect x={PAD.left + i * step} y={0} width={step} height={height} fill="transparent"
              onMouseEnter={() => setTip({ x: (x(i) / W) * 100, y: 4, lines: tips[i] })} />
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Horizontal bars as HTML: label | bar | value | share. */
export function HBars({ rows, color }: { rows: { label: ReactNode; value: number; text: string; share?: string; muted?: boolean }[]; color: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div key={i} className={`hbar ${r.muted ? "muted" : ""}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: max > 0 ? `${(r.value / max) * 100}%` : 0, background: r.muted ? "var(--border)" : color }} />
          </span>
          <span className="num">{r.text}</span>
          {r.share !== undefined && <span className="num muted">{r.share}</span>}
        </div>
      ))}
    </div>
  );
}
