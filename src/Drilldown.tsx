import { Fragment, useEffect, useState } from "react";
import { api, CreditNoteDetail, Documents, Filters, InvoiceDetail, PersonRow } from "./api";
import { day, money, status } from "./format";
import { displayName } from "./SalesTable";
import { companyOf } from "./demo/data";

const companyName = (code: string) => companyOf(code)?.name ?? code;

// Salesperson → their invoices and their credit notes of the period (the ERP's rule: a credit note under its own
// salesperson and date), each credit note with the invoices it was applied to.
// A document number opens its detail; from there, linked documents open in turn (with a "back" link).
// In production every document also links to the ERP, so accounting can find it there.

export type DocRef = { type: "invoice" | "credit_note"; id: string };

type Props = {
  person: PersonRow;
  filters: Filters;
  period: { start: string; end: string };
  onClose: () => void;
};

export function SalespersonPanel({ person, filters, period, onClose }: Props) {
  const [docs, setDocs] = useState<Documents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<DocRef[]>([]);

  useEffect(() => {
    setDocs(null);
    setError(null);
    api.documents(person.name, filters).then(setDocs, (e) => setError(String(e.message ?? e)));
  }, [person.name, filters]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stack.length) setStack(stack.slice(0, -1));
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack, onClose]);

  const show = (ref: DocRef) => setStack([...stack, ref]);

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={displayName(person)}>
        <div className="panel-head">
          <div>
            <h2>{displayName(person)}</h2>
            <p className="muted">
              {day(period.start)} to {day(period.end)} · Net{" "}
              <strong>{person.totals.map((t) => money(t.net, t.currency)).join(" · ")}</strong>
            </p>
          </div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <p className="error">{error}</p>}
        {!docs && !error && <p className="muted">Loading…</p>}
        {docs && (
          <>
            <h3>Invoices <span className="count">{docs.invoices.length}</span></h3>
            {docs.invoices.length === 0 ? <p className="muted">No invoices in the period.</p> : (
              <div className="scroll"><table className="docs">
                <thead>
                  <tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Co.</th><th>Region</th><th className="num">Sales</th></tr>
                </thead>
                <tbody>
                  {docs.invoices.map((inv) => (
                    <tr key={inv.id} className={inv.status === "void" ? "void" : ""}>
                      <td className="nowrap">{day(inv.date)}</td>
                      <td className="nowrap">
                        <button type="button" className="link" onClick={() => show({ type: "invoice", id: inv.id })}>{inv.number}</button>
                        {inv.status === "void" && <span className="tag">Void</span>}
                        {inv.document_currency !== inv.currency && <span className="tag" title="Amounts converted at the document's exchange rate">{inv.document_currency}</span>}
                      </td>
                      <td className="clip" title={inv.customer}>{inv.customer}</td>
                      <td>{companyOf(inv.company)?.short ?? inv.company}</td>
                      <td className="clip" title={inv.region_from_billing ? "No region on the shipping address: billing address used" : undefined}>
                        {inv.region}{inv.region_from_billing && <span className="muted"> (billing)</span>}
                      </td>
                      <td className="num">{money(inv.sales, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}

            <h3>Credit notes <span className="count">{docs.credit_notes.length}</span></h3>
            <p className="muted small">
              As in the ERP: under the credit note's own salesperson, on the credit note's date, applied or not.
              "Applied to" shows the invoice it corrected.
            </p>
            {docs.credit_notes.length === 0 ? <p className="muted">None.</p> : (
              <div className="scroll"><table className="docs">
                <thead>
                  <tr><th>Date</th><th>Credit note</th><th>Customer</th><th>Co.</th><th>Applied to</th><th className="num">Counted</th></tr>
                </thead>
                <tbody>
                  {docs.credit_notes.map((cn) => (
                    <tr key={cn.id} className={cn.status === "void" ? "void" : ""}>
                      <td className="nowrap">{day(cn.date)}</td>
                      <td className="nowrap">
                        <button type="button" className="link" onClick={() => show({ type: "credit_note", id: cn.id })}>{cn.number}</button>
                        {cn.status === "void" && <span className="tag">Void</span>}
                      </td>
                      <td className="clip" title={cn.customer}>{cn.customer}</td>
                      <td>{companyOf(cn.company)?.short ?? cn.company}</td>
                      <td>
                        {cn.applied_to.length === 0 ? <span className="muted">Not applied</span> : cn.applied_to.map((inv, i) => (
                          <Fragment key={inv.id}>
                            {i > 0 && ", "}
                            <button type="button" className="link" onClick={() => show({ type: "invoice", id: inv.id })}
                              title={[inv.date && `dated ${day(inv.date)}`, inv.salesperson && `salesperson: ${inv.salesperson}`].filter(Boolean).join(", ")}>
                              {inv.number}
                            </button>
                            {inv.date && <span className="muted small"> ({day(inv.date)})</span>}
                          </Fragment>
                        ))}
                      </td>
                      <td className="num">{money(cn.counted, cn.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </>
        )}

        {stack.length > 0 && (
          <DocumentDetail key={stack.length} doc={stack[stack.length - 1]} canGoBack={stack.length > 1}
            onBack={() => setStack(stack.slice(0, -1))} onClose={() => setStack([])} onShow={show} />
        )}
      </aside>
    </div>
  );
}


function DocumentDetail({ doc, canGoBack, onBack, onClose, onShow }: {
  doc: DocRef; canGoBack: boolean; onBack: () => void; onClose: () => void; onShow: (d: DocRef) => void;
}) {
  const [data, setData] = useState<InvoiceDetail | CreditNoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    const load = doc.type === "invoice" ? api.invoice(doc.id) : api.creditNote(doc.id);
    load.then(setData, (e) => setError(String(e.message ?? e)));
  }, [doc.type, doc.id]);

  return (
    <div className="doc-overlay" onClick={onClose}>
      <div className="doc" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="panel-head">
          <div>
            {canGoBack && <button type="button" className="link small" onClick={onBack}>← Back</button>}
            <h2>{doc.type === "invoice" ? "Invoice" : "Credit note"} {data?.number ?? ""}</h2>
          </div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <p className="error">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && doc.type === "invoice" && <InvoiceBody inv={data as InvoiceDetail} onShow={onShow} />}
        {data && doc.type === "credit_note" && <CreditNoteBody cn={data as CreditNoteDetail} onShow={onShow} />}
      </div>
    </div>
  );
}

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
      ))}
    </dl>
  );
}

/** In production, every document number links straight to the ERP; the demo has no ERP behind it. */
function ErpNote({ kind }: { kind: string }) {
  return (
    <p className="erp-note">
      In the production version, clicking this {kind} opens it directly in Zoho, in a new tab. This demo shows its
      details here instead.
    </p>
  );
}

function InvoiceBody({ inv, onShow }: { inv: InvoiceDetail; onShow: (d: DocRef) => void }) {
  const m = (v: number) => money(v, inv.currency);
  return (
    <>
      <Facts items={[
        ["Date", day(inv.date)],
        ["Company", companyName(inv.company)],
        ["Customer", inv.customer],
        ["Salesperson", inv.salesperson ?? "Unassigned"],
        ["Status", status(inv.status)],
        inv.region_from_billing ? ["Region (billing address)", inv.region] : ["Shipping region", inv.region],
      ]} />
      <ErpNote kind="invoice" />
      <h3>Amounts ({inv.currency})</h3>
      <table className="breakdown">
        <tbody>
          <tr><td>Subtotal</td><td className="num">{m(inv.sub_total)}</td></tr>
          {inv.discount !== 0 && <tr><td>Discount</td><td className="num">{m(inv.discount)}</td></tr>}
          {inv.shipping !== 0 && <tr><td>Shipping</td><td className="num">{m(inv.shipping)}</td></tr>}
          {inv.adjustment !== 0 && <tr><td>Adjustment</td><td className="num">{m(inv.adjustment)}</td></tr>}
          <tr className="strong"><td>Before taxes</td><td className="num">{m(inv.total - inv.tax)}</td></tr>
          <tr><td>Taxes</td><td className="num">{m(inv.tax)}</td></tr>
          <tr className="strong"><td>Total</td><td className="num">{m(inv.total)}</td></tr>
        </tbody>
      </table>
      <h3>Credit notes applied <span className="count">{inv.credit_notes.length}</span></h3>
      {inv.credit_notes.length === 0 ? <p className="muted">None.</p> : (
        <table className="docs">
          <thead><tr><th>Credit note</th><th>Date</th><th>Applied on</th><th>Status</th><th className="num">Applied (incl. taxes)</th></tr></thead>
          <tbody>
            {inv.credit_notes.map((cn) => (
              <tr key={cn.id}>
                <td><button type="button" className="link" onClick={() => onShow({ type: "credit_note", id: cn.id })}>{cn.number}</button></td>
                <td>{day(cn.date)}</td>
                <td>{day(cn.applied_on)}</td>
                <td>{status(cn.status)}</td>
                <td className="num">{money(cn.applied, cn.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CreditNoteBody({ cn, onShow }: { cn: CreditNoteDetail; onShow: (d: DocRef) => void }) {
  const m = (v: number) => money(v, cn.currency);
  return (
    <>
      <Facts items={[
        ["Date", day(cn.date)],
        ["Company", companyName(cn.company)],
        ["Customer", cn.customer],
        ["Salesperson", cn.salesperson ?? "Unassigned"],
        ["Status", status(cn.status)],
      ]} />
      <ErpNote kind="credit note" />
      <h3>Amounts ({cn.currency})</h3>
      <table className="breakdown">
        <tbody>
          <tr className="strong"><td>Before taxes</td><td className="num">{m(cn.total - cn.tax)}</td></tr>
          <tr><td>Taxes</td><td className="num">{m(cn.tax)}</td></tr>
          <tr className="strong"><td>Total</td><td className="num">{m(cn.total)}</td></tr>
          <tr><td>Not applied</td><td className="num">{m(cn.unapplied)}</td></tr>
        </tbody>
      </table>
      <h3>Invoices credited <span className="count">{cn.invoices.length}</span></h3>
      {cn.invoices.length === 0 ? <p className="muted">Not applied to any invoice (still counted, under the credit note's salesperson).</p> : (
        <table className="docs">
          <thead><tr><th>Invoice</th><th>Date</th><th>Salesperson</th><th>Status</th><th className="num">Applied (incl. taxes)</th></tr></thead>
          <tbody>
            {cn.invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  {inv.status === "missing" ? inv.number : (
                    <button type="button" className="link" onClick={() => onShow({ type: "invoice", id: inv.id })}>{inv.number}</button>
                  )}
                </td>
                <td>{day(inv.date)}</td>
                <td>{inv.salesperson ?? "Unassigned"}</td>
                <td>{status(inv.status)}</td>
                <td className="num">{m(inv.applied)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
