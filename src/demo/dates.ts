// Dates are ISO strings ("2026-11-12") everywhere; arithmetic goes through day numbers (days since 1970-01-01, UTC)
// so no time zone can shift a date by one day.

export const toDay = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export const toIso = (day: number): string => new Date(day * 86400000).toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string => toIso(toDay(iso) + n);

export const daysBetween = (from: string, to: string): number => toDay(to) - toDay(from);

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in the visitor's own time zone. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return toIso(Date.UTC(y, m, 1) / 86400000 - 1);
}

/** Weekday of an ISO date: 0 = Sunday … 6 = Saturday. */
export const weekday = (iso: string): number => new Date(toDay(iso) * 86400000).getUTCDay();
