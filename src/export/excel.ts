// Excel export: one sheet per company, in the layout of the ERP's "Invoice by salesperson" report that
// accounting already used:
//
//   Name | Sales Channel | Customer Name | Partnership | Sales Type | Total Sub Total (BCY)
//
// one row per combination of those five, sorted column by column, "-No Value-" where the field is empty, rows at
// zero left out, then "Grand Total:". With "Taxes included" on, the column is "Total (BCY)". Under it, the credit
// notes per salesperson and customer, their total, then "Net:" = the company's net on the screen. Same report as
// the screen, so the same filters and rules; each sheet in its company's own currency, nothing converted.

import ExcelJS from "exceljs";
import type { Filters } from "../api";
import { COMPANIES, Company } from "../demo/data";
import { Line, salespersonLines, setAsideLines } from "../demo/engine";
import { engineReport } from "../demo/server";
import { saveBlob } from "./save";

const MONEY: Record<string, string> = { CAD: '"$"#,##0.00', USD: '"US$"#,##0.00' };
// Same colours as the table style, also set on the cells: apps that ignore Excel table styles (Apple Numbers,
// Quick Look) still show the header and the banding.
const HEADER = "FF4472C4";
const BAND = "FFD9E1F2";
const TOTAL = "FFB4C6E7";
const NO_VALUE = "-No Value-";
const WIDTHS = [26, 22, 40, 20, 22, 22];

type Key = string[];

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** Column by column, by code point (capitals first, like the ERP's report); rows at zero left out. */
function sortedRows(rows: Map<string, { key: Key; amount: number }>) {
  return [...rows.values()]
    .filter((r) => Math.round(r.amount * 100) !== 0)
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] < b.key[i] ? -1 : 1;
      return 0;
    });
}

const nameOf = (l: Line) => l.salesperson.name;
const field = (v: string) => v || NO_VALUE;

function companySheet(wb: ExcelJS.Workbook, c: Company, lines: Line[], amountHeader: string) {
  const ws = wb.addWorksheet(c.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  const money = MONEY[c.currency];
  const sales = new Map<string, { key: Key; amount: number }>();
  const credits = new Map<string, { key: Key; amount: number }>();
  const add = (m: typeof sales, key: Key, amount: number) => {
    const k = key.join("\u0000");
    const row = m.get(k) ?? { key, amount: 0 };
    row.amount += amount;
    m.set(k, row);
  };
  for (const line of lines) {
    for (const e of line.entries) {
      if (e.kind === "sale") {
        const inv = e.invoice!;
        add(sales, [nameOf(line), field(inv.sales_channel), field(inv.customer), field(inv.partnership), field(inv.sales_type)], e.amount);
      } else {
        add(credits, [nameOf(line), field(e.creditNote!.customer)], e.amount);
      }
    }
  }
  const totalSales = [...sales.values()].reduce((s, r) => s + r.amount, 0);
  const totalCredits = [...credits.values()].reduce((s, r) => s + r.amount, 0);
  const cents = (v: number) => Math.round(v * 100) / 100;

  const header = (values: (string | null)[]) => {
    const row = ws.addRow(values);
    for (let col = 1; col <= 6; col++) {
      const cell = row.getCell(col);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = fill(HEADER);
    }
  };
  const body = (values: (string | null)[], amount: number, band: boolean) => {
    const row = ws.addRow([...values, cents(amount)]);
    row.getCell(6).numFmt = money;
    if (band) for (let col = 1; col <= 6; col++) row.getCell(col).fill = fill(BAND);
  };
  const total = (label: string, amount: number) => {
    const row = ws.addRow([label, null, null, null, null, cents(amount)]);
    row.getCell(6).numFmt = money;
    for (let col = 1; col <= 6; col++) {
      const cell = row.getCell(col);
      cell.font = { bold: true };
      cell.fill = fill(TOTAL);
      cell.border = { top: { style: "medium", color: { argb: HEADER } } };
    }
  };

  const rows = sortedRows(sales);
  const columns = ["Name", "Sales Channel", "Customer Name", "Partnership", "Sales Type", amountHeader];
  if (rows.length) {
    // A real Excel table: styled header, banded rows, filter buttons.
    ws.addTable({
      name: `Invoices${c.code}`, ref: "A1", headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: columns.map((name) => ({ name, filterButton: true })),
      rows: rows.map((r) => [...r.key, cents(r.amount)]),
    });
    for (let i = 0; i < rows.length; i++) {
      const row = ws.getRow(i + 2);
      row.getCell(6).numFmt = money;
      if (i % 2 === 1) for (let col = 1; col <= 6; col++) row.getCell(col).fill = fill(BAND);
    }
    const head = ws.getRow(1);
    for (let col = 1; col <= 6; col++) {
      head.getCell(col).font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.getCell(col).fill = fill(HEADER);
    }
  } else {
    header(columns);
  }
  total("Grand Total:", totalSales);

  ws.addRow([]);
  header(["Credit Notes", null, "Customer Name", null, null, "Amount"]);
  sortedRows(credits).forEach((r, i) => body([r.key[0], null, r.key[1], null, null], r.amount, i % 2 === 1));
  total("Total Credit Notes:", totalCredits);
  total("Net:", totalSales - totalCredits);
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

export async function downloadWorkbook(filters: Filters): Promise<void> {
  const r = engineReport(filters);
  const o = r.options;
  // Set-aside amounts only count with the filter on, like the totals on the screen.
  const lines = [...salespersonLines(r), ...(o.countSetAside ? setAsideLines(r) : [])];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sales Dashboard (demo)";
  for (const c of COMPANIES) {
    if (o.company === null || o.company === c.code) {
      companySheet(wb, c, lines.filter((l) => l.company === c.code), o.includeTax ? "Total (BCY)" : "Total Sub Total (BCY)");
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `sales-by-salesperson_${o.start}_${o.end}.xlsx`);
}
