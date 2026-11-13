// English (Canada) formatting: "$1,234.56" for CAD, "US$1,234.56" for USD.

const LOCALE = "en-CA";
const moneyFormats = new Map<string, Intl.NumberFormat>();

export function money(value: number, currency: string): string {
  let f = moneyFormats.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { style: "currency", currency });
    moneyFormats.set(currency, f);
  }
  return f.format(value);
}

const amountFormat = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,234.56" without the currency: only where the currency is written just above (compare tables). */
export function amount(value: number): string {
  return amountFormat.format(value);
}

const pctFormat = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function pct(value: number | null): string {
  return value === null ? "—" : `${pctFormat.format(value)}%`;
}

export function day(iso: string | null): string {
  if (!iso) return "—";
  // Noon avoids the date shifting by a day in any time zone.
  return new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
}

const STATUS: Record<string, string> = {
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  partially_paid: "Partially paid",
  void: "Void",
  open: "Open",
  closed: "Closed",
  draft: "Draft",
  missing: "Not in data",
};

export function status(value: string): string {
  return STATUS[value] ?? value;
}

export function currencyLabel(currency: string): string {
  return currency;
}
