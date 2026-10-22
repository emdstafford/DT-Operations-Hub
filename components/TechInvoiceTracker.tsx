"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type InvoiceStatus = "open" | "paid" | "void";
type Invoice = {
  id: string;
  vendor: string;
  invoice_number: string | null;
  description: string;
  category: string;
  invoice_date: string | null;
  due_date: string;
  amount: number;
  status: InvoiceStatus;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
};
type InvoiceDraft = {
  vendor: string;
  invoice_number: string;
  description: string;
  category: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  status: "open" | "paid";
  paid_at: string;
  notes: string;
};

const emptyDraft: InvoiceDraft = { vendor: "", invoice_number: "", description: "", category: "Other", invoice_date: "", due_date: "", amount: 0, status: "open", paid_at: "", notes: "" };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const localDate = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const today = () => localDate(new Date());
const dateInThirtyDays = () => { const date = new Date(); date.setDate(date.getDate() + 30); return localDate(date); };
const currentYear = new Date().getFullYear();
function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Date(value + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TechInvoiceTracker() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tableReady, setTableReady] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [yearFilter, setYearFilter] = useState(String(currentYear));

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase.from("tech_invoices").select("id, vendor, invoice_number, description, category, invoice_date, due_date, amount, status, paid_at, notes, created_at").order("due_date", { ascending: true });
    if (loadError) {
      setTableReady(false);
      setError(loadError.message);
      setInvoices([]);
    } else {
      setTableReady(true);
      setError("");
      setInvoices((data || []) as Invoice[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadInvoices(); }, [loadInvoices]);
  const activeInvoices = useMemo(() => invoices.filter((invoice) => invoice.status !== "void"), [invoices]);
  const paidInvoices = useMemo(() => activeInvoices.filter((invoice) => invoice.status === "paid"), [activeInvoices]);
  const yearOptions = useMemo(() => {
    const years = new Set([currentYear]);
    invoices.forEach((invoice) => {
      if (invoice.paid_at) years.add(Number(invoice.paid_at.slice(0, 4)));
      if (invoice.due_date) years.add(Number(invoice.due_date.slice(0, 4)));
    });
    return [...years].sort((a, b) => b - a);
  }, [invoices]);

  const summary = useMemo(() => {
    const selectedYear = yearFilter === "all" ? null : Number(yearFilter);
    const spent = paidInvoices.filter((invoice) => !selectedYear || Number(invoice.paid_at?.slice(0, 4)) === selectedYear);
    const open = activeInvoices.filter((invoice) => invoice.status === "open");
    const overdue = open.filter((invoice) => invoice.due_date < today());
    const nextThirtyDays = open.filter((invoice) => invoice.due_date >= today() && invoice.due_date <= dateInThirtyDays());
    return {
      spent: spent.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      allTime: paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      openAmount: open.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      overdueAmount: overdue.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      overdueCount: overdue.length,
      nextAmount: nextThirtyDays.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      nextCount: nextThirtyDays.length,
      openCount: open.length,
    };
  }, [activeInvoices, paidInvoices, yearFilter]);

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const matchesSearch = !query || [invoice.vendor, invoice.invoice_number, invoice.description, invoice.category].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = statusFilter === "all" || invoice.status === statusFilter || (statusFilter === "overdue" && invoice.status === "open" && invoice.due_date < today());
      const matchesYear = yearFilter === "all" || invoice.due_date.startsWith(yearFilter) || Boolean(invoice.paid_at?.startsWith(yearFilter));
      return matchesSearch && matchesStatus && matchesYear;
    }).sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [invoices, search, statusFilter, yearFilter]);

  function startNew() {
    setEditing(null);
    setDraft({ ...emptyDraft, invoice_date: today() });
    setError("");
    setShowForm(true);
  }
  function startEdit(invoice: Invoice) {
    setEditing(invoice.id);
    setDraft({ vendor: invoice.vendor, invoice_number: invoice.invoice_number || "", description: invoice.description, category: invoice.category || "Other", invoice_date: invoice.invoice_date || "", due_date: invoice.due_date, amount: Number(invoice.amount), status: invoice.status === "paid" ? "paid" : "open", paid_at: invoice.paid_at || "", notes: invoice.notes || "" });
    setError("");
    setShowForm(true);
  }
  async function saveInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const payload = { ...draft, vendor: draft.vendor.trim(), invoice_number: draft.invoice_number.trim() || null, description: draft.description.trim(), category: draft.category.trim() || "Other", invoice_date: draft.invoice_date || null, due_date: draft.due_date, amount: Number(draft.amount), paid_at: draft.status === "paid" ? draft.paid_at : null, notes: draft.notes.trim() || null, updated_at: new Date().toISOString() };
    const result = editing ? await supabase.from("tech_invoices").update(payload).eq("id", editing) : await supabase.from("tech_invoices").insert(payload);
    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }
    setShowForm(false);
    setEditing(null);
    setDraft(emptyDraft);
    setNotice(editing ? "Invoice updated." : "Invoice added.");
    await loadInvoices();
    setSaving(false);
  }
  async function setInvoiceStatus(invoice: Invoice, status: InvoiceStatus) {
    setError("");
    setNotice("");
    const { error: updateError } = await supabase.from("tech_invoices").update({ status, paid_at: status === "paid" ? today() : null, updated_at: new Date().toISOString() }).eq("id", invoice.id);
    if (updateError) { setError(updateError.message); return; }
    setNotice(status === "paid" ? invoice.vendor + " marked paid." : status === "void" ? invoice.vendor + " invoice voided." : "Invoice reopened.");
    await loadInvoices();
  }

  const sqlMessage = !tableReady && /tech_invoices|schema cache|does not exist/i.test(error)
    ? "The invoice table is not set up yet. Run supabase/tech_invoice_tracker.sql in the Supabase SQL Editor, then reload this page."
    : "";

  return (
    <section className="invoice-tracker">
      <div className="invoice-actions"><p>Enter invoices as they arrive, then mark them paid when they clear.</p><button type="button" className="primary-link" onClick={startNew}>＋ Add invoice</button></div>
      {error && <div className="alert alert-error" role="alert">{sqlMessage || error}</div>}
      {notice && <div className="invoice-notice" role="status">{notice}</div>}

      <div className="invoice-metrics" aria-label="Invoice summary">
        <article><span>Paid in {yearFilter === "all" ? "all years" : yearFilter}</span><strong>{money.format(summary.spent)}</strong><small>Counted by payment date</small></article>
        <article><span>Paid all time</span><strong>{money.format(summary.allTime)}</strong><small>Excludes open and void invoices</small></article>
        <article><span>Open balance</span><strong>{money.format(summary.openAmount)}</strong><small>{summary.openCount} unpaid invoices</small></article>
        <article className={summary.overdueCount ? "is-overdue" : ""}><span>Past due</span><strong>{money.format(summary.overdueAmount)}</strong><small>{summary.overdueCount} overdue invoices</small></article>
        <article><span>Due in the next 30 days</span><strong>{money.format(summary.nextAmount)}</strong><small>{summary.nextCount} upcoming invoices</small></article>
      </div>

      {showForm && <form className="invoice-form" onSubmit={saveInvoice}>
        <div className="invoice-form-heading"><div><p className="eyebrow">{editing ? "Update record" : "New record"}</p><h2>{editing ? "Edit invoice" : "Add a tech invoice"}</h2></div><button type="button" className="text-button" onClick={() => setShowForm(false)}>Cancel</button></div>
        <div className="invoice-form-grid">
          <label>Vendor<input required maxLength={120} value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} placeholder="e.g. Internet provider" /></label>
          <label>Invoice number <span className="optional">(optional)</span><input maxLength={80} value={draft.invoice_number} onChange={(e) => setDraft({ ...draft, invoice_number: e.target.value })} /></label>
          <label>Description<input required maxLength={180} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Service, equipment, or subscription" /></label>
          <label>Category<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}><option>Software</option><option>Internet &amp; phone</option><option>Equipment</option><option>IT support</option><option>Other</option></select></label>
          <label>Invoice date<input type="date" value={draft.invoice_date} onChange={(e) => setDraft({ ...draft, invoice_date: e.target.value })} /></label>
          <label>Due date<input required type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></label>
          <label>Amount<input required type="number" min="0.01" step="0.01" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} placeholder="0.00" /></label>
          <label>Payment status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as "open" | "paid", paid_at: e.target.value === "paid" ? draft.paid_at || today() : "" })}><option value="open">Unpaid</option><option value="paid">Paid</option></select></label>
          {draft.status === "paid" && <label>Payment date<input required type="date" value={draft.paid_at} onChange={(e) => setDraft({ ...draft, paid_at: e.target.value })} /></label>}
          <label className="invoice-notes-field">Notes <span className="optional">(optional)</span><textarea rows={2} maxLength={1000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
        </div>
        {error && !sqlMessage && <div className="alert alert-error">{error}</div>}
        <div className="invoice-form-footer"><span>Invoice details are visible to admins only.</span><button className="primary-link" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save invoice"}</button></div>
      </form>}

      <div className="invoice-list-heading"><div><p className="eyebrow">Invoice register</p><h2>Invoices</h2></div>
        <div className="invoice-filters">
          <label className="sr-only" htmlFor="invoice-search">Search invoices</label><input id="invoice-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor or invoice" />
          <label className="sr-only" htmlFor="invoice-status">Invoice status</label><select id="invoice-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="open">Open</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option><option value="all">All statuses</option></select>
          <label className="sr-only" htmlFor="invoice-year">Invoice year</label><select id="invoice-year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}><option value="all">All years</option>{yearOptions.map((year) => <option value={year} key={year}>{year}</option>)}</select>
        </div>
      </div>
      <div className="invoice-table-wrap">
        {loading ? <p className="invoice-empty">Loading invoices…</p> : filteredInvoices.length === 0 ? <div className="invoice-empty"><strong>No invoices match these filters.</strong><span>Add an invoice to start tracking due dates and spend.</span></div> : (
          <table className="invoice-table"><thead><tr><th>Vendor / invoice</th><th>Description</th><th>Due date</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{filteredInvoices.map((invoice) => {
              const overdue = invoice.status === "open" && invoice.due_date < today();
              return <tr key={invoice.id}>
                <td><strong>{invoice.vendor}</strong><span>{invoice.invoice_number || "No invoice number"}</span></td>
                <td><strong>{invoice.description}</strong><span>{invoice.category}{invoice.notes ? " · " + invoice.notes : ""}</span></td>
                <td>{dateLabel(invoice.due_date)}{invoice.paid_at && <span>Paid {dateLabel(invoice.paid_at)}</span>}</td>
                <td className="invoice-amount">{money.format(Number(invoice.amount))}</td>
                <td><span className={"invoice-status " + (overdue ? "overdue" : invoice.status)}>{overdue ? "Overdue" : invoice.status === "open" ? "Open" : invoice.status === "paid" ? "Paid" : "Void"}</span></td>
                <td><div className="invoice-row-actions">
                  {invoice.status !== "void" && <button type="button" onClick={() => startEdit(invoice)}>Edit</button>}
                  {invoice.status === "open" && <button type="button" onClick={() => void setInvoiceStatus(invoice, "paid")}>Mark paid</button>}
                  {invoice.status === "paid" && <button type="button" onClick={() => void setInvoiceStatus(invoice, "open")}>Reopen</button>}
                  {invoice.status !== "void" && <button type="button" className="void-action" onClick={() => void setInvoiceStatus(invoice, "void")}>Void</button>}
                  {invoice.status === "void" && <button type="button" onClick={() => void setInvoiceStatus(invoice, "open")}>Restore</button>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>
      <style jsx>{styles}</style>
    </section>
  );
}

const styles = [
  ".invoice-tracker{display:grid;gap:18px}",
  ".invoice-actions{display:flex;justify-content:space-between;align-items:center;gap:16px}.invoice-actions p{color:#627283;margin:0}",
  ".invoice-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.invoice-metrics article{display:grid;gap:7px;padding:17px;border:1px solid #dce3ea;border-radius:11px;background:white;box-shadow:0 5px 18px #142d4608}.invoice-metrics article span{font-size:.74rem;font-weight:800;letter-spacing:.045em;text-transform:uppercase;color:#647487}.invoice-metrics article strong{font-size:1.45rem;color:#123a60;letter-spacing:-.03em}.invoice-metrics article small{font-size:.74rem;color:#728090;line-height:1.35}.invoice-metrics article.is-overdue{border-color:#e6c5c8;background:#fffafa}.invoice-metrics article.is-overdue strong{color:#9b343c}",
  ".invoice-notice{padding:12px 15px;border-radius:8px;background:#e8f3ec;color:#225c39;font-weight:700}.invoice-form{padding:22px;border:1px solid #d7e0e8;border-radius:12px;background:white;box-shadow:0 8px 26px #142d460a}.invoice-form-heading,.invoice-form-footer{display:flex;align-items:center;justify-content:space-between;gap:14px}.invoice-form-heading{margin-bottom:18px}.invoice-form-heading h2,.invoice-list-heading h2{margin:3px 0;color:#0b3158;font-size:1.35rem}",
  ".invoice-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.invoice-form-grid label{display:grid;gap:6px;color:#34495e;font-size:.82rem;font-weight:700}.invoice-form-grid input,.invoice-form-grid select,.invoice-form-grid textarea,.invoice-filters input,.invoice-filters select{width:100%;min-height:42px;border:1px solid #bdc9d4;border-radius:7px;background:#fff;padding:9px 11px;color:#172b3f;font:inherit}.invoice-form-grid textarea{resize:vertical}.invoice-notes-field{grid-column:span 2}.optional{color:#8290a0;font-weight:400}.invoice-form-footer{margin-top:18px;padding-top:14px;border-top:1px solid #e5e9ed}.invoice-form-footer span{font-size:.78rem;color:#718090}.invoice-form-footer button:disabled{opacity:.55;cursor:wait}",
  ".invoice-list-heading{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-top:12px}.invoice-filters{display:flex;gap:8px;align-items:center}.invoice-filters input{min-width:220px}.invoice-filters select{width:auto;min-width:125px}",
  ".invoice-table-wrap{overflow-x:auto;border:1px solid #dce3ea;border-radius:10px;background:white}.invoice-table{width:100%;border-collapse:collapse;text-align:left}.invoice-table th{padding:12px 14px;background:#f1f5f8;color:#5d6d7c;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.invoice-table td{padding:13px 14px;border-top:1px solid #e7ebef;vertical-align:middle;font-size:.86rem}.invoice-table td strong,.invoice-table td span{display:block}.invoice-table td span{margin-top:4px;color:#748292;font-size:.75rem;max-width:330px;white-space:normal;line-height:1.4}.invoice-table .invoice-amount{font-weight:800;color:#173b62;white-space:nowrap}",
  ".invoice-status{display:inline-flex!important;width:max-content;border-radius:999px;padding:5px 9px;background:#fff1dc;color:#825916!important;font-weight:800}.invoice-status.paid{background:#e4f2e9;color:#286343!important}.invoice-status.overdue{background:#fae5e6;color:#9b343c!important}.invoice-status.void{background:#e9edf1;color:#687787!important}.invoice-row-actions{display:flex;gap:6px;flex-wrap:wrap}.invoice-row-actions button{border:1px solid #d3dce4;border-radius:6px;padding:6px 8px;background:#fff;color:#244969;font-size:.74rem;font-weight:700;cursor:pointer;white-space:nowrap}.invoice-row-actions button:hover{background:#eff4f8}.invoice-row-actions .void-action{color:#8b3d42}",
  ".invoice-empty{display:grid;gap:6px;justify-items:center;padding:36px 16px;color:#647487}.invoice-empty strong{color:#34495e}.invoice-empty span{font-size:.84rem}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
  "@media(max-width:1050px){.invoice-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.invoice-list-heading{align-items:stretch;flex-direction:column}.invoice-filters{flex-wrap:wrap}.invoice-filters input{flex:1;min-width:180px}}@media(max-width:650px){.invoice-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.invoice-form-grid{grid-template-columns:1fr}.invoice-notes-field{grid-column:auto}.invoice-actions{align-items:stretch;flex-direction:column}.invoice-actions .primary-link{align-self:flex-start}.invoice-filters input{flex-basis:100%}.invoice-filters select{flex:1}.invoice-form-footer{align-items:flex-start;flex-direction:column}}",
].join("");
