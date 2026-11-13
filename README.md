# Sales Dashboard (demo)

**Live demo: https://tristan-massicotte.github.io/sales-dashboard/**

A public demo of a sales dashboard I built at work for a manufacturer with three companies and two currencies
(two companies bill in CAD, one in USD). The production version runs on the company's real invoices and is in
daily use. This version runs the same calculation rules in your browser on generated data: the companies
("Halden Canada", "Halden Systems", "Halden Inc."), customers, salespeople and amounts are all fictional.

## What it does

- **Sales by salesperson**, per company and per currency, for the last 30 / 90 / 365 days or any custom period,
  with the change against the previous period.
- **Drill-down**: click a salesperson to see every invoice and credit note counted for them, then any document
  for its full breakdown (subtotal, discount, shipping, taxes) and the documents linked to it.
- **Compare**: two custom periods side by side, each salesperson on the same line in both, with the % change.
- **Map**: sales by province, state and country on a globe; click a region to filter the whole dashboard to it.
- **KPI page**: monthly sales and credit-note rate over 12 months, unpaid invoices by age (not due, 1–30,
  31–60, 61–90, 90+ days) and the largest overdue balances.
- **Excel export**: one sheet per company, in the layout of the ERP's "invoice by salesperson" report that
  accounting already used, plus credit notes and net.
- **PowerPoint export**: a deck for the leadership meeting (sales by company, monthly trend, salesperson of
  the period, sales map), with native, editable charts.

## The rules that mattered

Rules agreed with accounting, applied the same way on every screen and export:

- **Credit notes follow the ERP's own rule**: a credit note counts under its own salesperson, on its own date,
  whether or not it has been applied to an invoice. (The original plan put it in the period of the invoice it
  corrects; it was changed to count the way the ERP's own reports do.)
- **USD and CAD are never added.** Each company stays in its own currency; someone selling in both has a row in
  each table. The only exception is the map's "% of total sales", which converts at the period's average rate
  and says so on screen.
- **Before taxes** by default (total − tax), with a toggle.
- **Draft and void documents never count.** Entries made by accounting are set aside: never under a
  salesperson, but counted in the company totals (production has a toggle to leave them out; the demo always
  counts them).
- **Every total is traceable**: the drill-down lists exactly the documents the engine added up, so any number
  on screen can be checked document by document.

The production version was checked against the ERP's own reports and matched them to the cent, by company and
per salesperson.

## How it is built

| | Production | This demo |
|---|---|---|
| Data | Incremental sync from the Zoho Inventory API into SQLite (invoices, credit notes, applications), every weekday at 7:00 | Generated in the browser from a fixed seed (`src/demo/data.ts`) |
| Calculation | Python engine (FastAPI) | The same engine ported to TypeScript (`src/demo/engine.ts`) |
| API | FastAPI routes (`/api/report`, `/api/kpi`, …) | The same routes as functions with the same JSON shapes (`src/demo/server.ts`) |
| Frontend | React 18 + TypeScript + Vite, MapLibre GL | Same, translated to English |
| Excel / PowerPoint | openpyxl, python-pptx | ExcelJS, PptxGenJS, in the browser |
| Hosting | Docker on the company's server, behind a login | GitHub Pages, static |

The production version also has a password login, a scheduled refresh, and 94 backend tests. The demo keeps the
tests that matter for the numbers: `npm test` checks that rows add up to the totals to the cent, that the
drill-down adds up to each row, and that a region's figures equal its value on the map, for every period and
filter combination.

## Run it locally

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # engine checks
npm run build   # static site in dist/
```

## About the data

The generator creates invoices from July 2024 to today (roughly 150 a month across the three companies), credit notes
on about 6% of them, partial and late payments, a few USD invoices from the Canadian companies converted at a
made-up daily exchange rate, and sales tax by province. Each month comes from its own seed, so a past month looks
the same every time you open the demo.

Map boundaries: [Natural Earth](https://www.naturalearthdata.com/) (public domain).

---

Built by Tristan Massicotte · Industrial Engineering, University of Toronto ·
[LinkedIn](https://www.linkedin.com/in/tristan-massicotte)
