// Sales heat map as a picture, for the PowerPoint deck: Canada and US regions plus the countries around them, with
// the same colours as the Map page (CAD blue, USD red, rest of the world green; darker = more sales, square-root
// scale per currency). Drawn on a canvas from the map's own boundaries (public/geo, Natural Earth) in an Albers
// equal-area projection centred on North America. Returns a PNG data URL.

import type { ByCurrency } from "../demo/engine";

const RAMPS = {
  CAD: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"],
  USD: ["#ee9897", "#e8706f", "#e34948", "#b83230", "#7f1d1c"],
  WORLD: ["#6abf6a", "#45a845", "#2e8b2e", "#1d6b1d", "#0d470d"],
};
const NO_SALES = "#d5d9de";
const NEGATIVE = "#3f444b";
const LAND = "#e3e7ec";
const LAND_LINE = "#c3cad2";
const BORDER = "#ffffff";

// Albers equal-area conic for North America.
const rad = (d: number) => (d * Math.PI) / 180;
const [PHI1, PHI2, PHI0, LAMBDA0] = [rad(38), rad(62), rad(50), rad(-96)];
const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(PHI0)) / N;
function project(lon: number, lat: number): [number, number] {
  const rho = Math.sqrt(Math.max(C - 2 * N * Math.sin(rad(lat)), 0)) / N;
  const theta = N * (rad(lon) - LAMBDA0);
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}

// Frame: southern Canada and the lower 48, where the sales are (the Arctic would take half the picture).
const FRAME_LON = [-126, -56];
const FRAME_LAT = [23.5, 60];

type Geo = { features: { properties: { code: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
type Shape = { code: string; rings: [number, number][][] };

async function shapes(file: string, keep: (code: string) => boolean): Promise<Shape[]> {
  const geo: Geo = await (await fetch(`${import.meta.env.BASE_URL}geo/${file}`)).json();
  return geo.features.filter((f) => keep(f.properties.code)).map((f) => {
    const polys = (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates]) as number[][][][];
    // Outer rings only; skip rings across the antimeridian (Aleutians, Chukotka…).
    const rings = polys.map((p) => p[0]).filter((ring) => !ring.some(([lon]) => lon > 0)).map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
    return { code: f.properties.code, rings };
  });
}

function hex(c: string): number[] {
  return [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
}

function along(ramp: string[], t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  const [a, b] = [hex(ramp[i]), hex(ramp[i + 1])];
  const f = x - i;
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

export async function heatmapPng(regionSales: Map<string | null, ByCurrency>, width = 1800): Promise<{ data: string; aspect: number }> {
  const [regions, countries] = await Promise.all([
    shapes("regions.json", (c) => c !== "US-HI"),
    shapes("countries.json", (c) => c !== "W-CA" && c !== "W-US"),
  ]);
  const home = new Map([...regionSales].filter(([c]) => c && !c.startsWith("W-")) as [string, ByCurrency][]);
  const world = new Map([...regionSales].filter(([c]) => c && c.startsWith("W-")) as [string, ByCurrency][]);
  const maxHome = { CAD: 0, USD: 0 };
  for (const v of home.values()) for (const cur of ["CAD", "USD"] as const) maxHome[cur] = Math.max(maxHome[cur], v[cur] ?? 0);
  let maxWorld = 0;
  for (const v of world.values()) maxWorld = Math.max(maxWorld, Object.values(v).reduce((s, x) => s + (x ?? 0), 0));

  const homeFill = (code: string) => {
    const sales = home.get(code) ?? {};
    // A region with both currencies takes its country's currency (as on the Map page).
    const own = code.startsWith("CA-") ? "CAD" : "USD";
    const cur = sales[own] ? own : (["CAD", "USD"] as const).find((c) => sales[c]);
    if (!cur) return NO_SALES;
    const v = sales[cur]!;
    if (v < 0) return NEGATIVE;
    return along(RAMPS[cur], maxHome[cur] ? Math.sqrt(v / maxHome[cur]) : 0);
  };
  const worldFill = (code: string) => {
    const v = Object.values(world.get(code) ?? {}).reduce((s, x) => s + (x ?? 0), 0);
    return v <= 0 || !maxWorld ? LAND : along(RAMPS.WORLD, Math.sqrt(v / maxWorld));
  };

  const edge: [number, number][] = [];
  for (let i = 0; i <= 20; i++) for (const lat of FRAME_LAT) edge.push(project(FRAME_LON[0] + ((FRAME_LON[1] - FRAME_LON[0]) * i) / 20, lat));
  const x0 = Math.min(...edge.map((p) => p[0]));
  const x1 = Math.max(...edge.map((p) => p[0]));
  const y0 = Math.min(...edge.map((p) => p[1]));
  const y1 = Math.max(...edge.map((p) => p[1]));
  const scale = width / (x1 - x0);
  const height = Math.round((y1 - y0) * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.lineJoin = "round";
  const path = (ring: [number, number][]) => {
    ctx.beginPath();
    ring.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (x - x0) * scale, (y1 - y) * scale));
    ctx.closePath();
  };
  for (const { code, rings } of countries) {
    for (const r of rings) {
      path(r);
      ctx.fillStyle = worldFill(code);
      ctx.fill();
      ctx.strokeStyle = LAND_LINE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  for (const { code, rings } of regions) {
    for (const r of rings) {
      path(r);
      ctx.fillStyle = homeFill(code);
      ctx.fill();
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
  return { data: canvas.toDataURL("image/png"), aspect: width / height };
}
