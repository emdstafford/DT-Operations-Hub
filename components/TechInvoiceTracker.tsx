"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type InvoiceStatus = "open" | "paid" | "void";
type BillingFrequency = "one_time" | "monthly" | "biweekly" | "yearly";
type InvoiceSortColumn = "vendor" | "due_date" | "amount" | "status";
type Invoice = {
  id: string;
  vendor: string;
  invoice_number: string | null;
  account_number: string | null;
  billing_frequency: BillingFrequency;
  reminder_days_before: number;
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
  account_number: string;
  billing_frequency: BillingFrequency;
  reminder_days_before: number;
  description: string;
  category: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  status: "open" | "paid";
  paid_at: string;
  notes: string;
};
type InvoicePdfDraft = {
  id: string;
  fileName: string;
  draft: InvoiceDraft;
  issue: string;
};

const invoiceCategories = ["Software", "Equipment", "Internet", "Phones", "IT support", "Other"];
const billingFrequencyLabels: Record<BillingFrequency, string> = { one_time: "One-time", monthly: "Monthly", biweekly: "Biweekly", yearly: "Yearly" };
const emptyDraft: InvoiceDraft = { vendor: "", invoice_number: "", account_number: "", billing_frequency: "one_time", reminder_days_before: 30, description: "", category: "Software", invoice_date: "", due_date: "", amount: 0, status: "open", paid_at: "", notes: "" };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const localDate = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const today = () => localDate(new Date());
const dateInDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return localDate(date); };
function nextBillingDate(value: string, frequency: BillingFrequency, anchorDay?: number): string | null {
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || frequency === "one_time") return null;
  const day = anchorDay || date.getUTCDate();
  if (frequency === "biweekly") date.setUTCDate(date.getUTCDate() + 14);
  else {
    let year = date.getUTCFullYear();
    let month = date.getUTCMonth();
    if (frequency === "monthly") month += 1;
    else year += 1;
    const firstOfTarget = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
    date.setTime(firstOfTarget.getTime());
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString().slice(0, 10);
}
function daysUntilLabel(value: string): string {
  const due = new Date(value + "T00:00:00Z");
  const start = new Date(today() + "T00:00:00Z");
  const days = Math.round((due.getTime() - start.getTime()) / 86400000);
  return days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`;
}
function upcomingBillDates(invoice: Invoice, days: number): string[] {
  const start = today();
  const end = dateInDays(days);
  const dates: string[] = [];
  if (invoice.status === "open" && invoice.due_date >= start && invoice.due_date <= end) dates.push(invoice.due_date);
  if (invoice.billing_frequency === "one_time") return dates;
  const anchorDay = new Date(invoice.due_date + "T00:00:00Z").getUTCDate();
  let nextDate: string | null = invoice.due_date;
  let attempts = 0;
  while (nextDate && attempts++ < 1000) {
    nextDate = nextBillingDate(nextDate, invoice.billing_frequency, anchorDay);
    if (!nextDate || nextDate > end) break;
    if (nextDate >= start) dates.push(nextDate);
  }
  return dates;
}
const currentYear = new Date().getFullYear();
function parseInvoiceDate(value: string) {
  const numericDate = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numericDate) {
    const month = Number(numericDate[1]);
    const day = Number(numericDate[2]);
    let year = Number(numericDate[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const namedDate = value.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i);
  if (!namedDate) return "";
  const date = new Date(namedDate[0]);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function extractInvoiceFields(text: string): Partial<InvoiceDraft> {
  const datePattern = "(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2},?\\s+\\d{4})";
  const dateFor = (label: string) => {
    const match = text.match(new RegExp(`${label}\\s*[:#-]?\\s*(${datePattern})`, "i"));
    return match ? parseInvoiceDate(match[1]) : "";
  };
  const invoiceNumber = text.match(/(?:invoice\s*(?:number|no\.?|#)|invoice\s*#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i)?.[1]
    || text.match(/\binvoice\s+([A-Z0-9][A-Z0-9/-]{2,})\s+(?=date\b)/i)?.[1]
    || "";
  const accountNumber = text.match(/(?:account\s*(?:number|no\.?|#)|acct\.?\s*(?:number|no\.?|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{1,})/i)?.[1] || "";
  const amountLine = text.match(/(?:amount\s*due|balance\s*due|total\s*due|invoice\s*total|grand\s*total)[^\d$]{0,18}\$?\s*([\d,]+\.\d{2})/i)?.[1];
  const amount = amountLine ? Number(amountLine.replace(/,/g, "")) : 0;
  const vendor = text.match(/^\s*(?:vendor|supplier|from)\s*:?\s*(.+?)\s*$/im)?.[1]?.trim()
    || text.match(/^\s*(?:Page\s+\d+\s+of\s+\d+\s+)?(.+?)\s+(?=INVOICE\b|BILL\s+TO\b)/im)?.[1]?.replace(/^Page\s+\d+\s+of\s+\d+\s+/i, "").replace(/\s+\d{1,6}\s+[A-Z][\s\S]*$/, "").trim()
    || "";
  const description = text.match(/^\s*description\s*:?\s*(.+?)\s*$/im)?.[1]?.trim()
    || text.match(/\bACTIVITY\s+DESCRIPTION\s+QTY\s+RATE\s+AMOUNT\s+(.+?)\s+\d+\s+[\d,]+\.\d{2}(?:[A-Z])?\b/i)?.[1]?.trim().replace(/\s+/g, " ")
    || "";
  return {
    vendor,
    invoice_number: invoiceNumber,
    account_number: accountNumber,
    description,
    invoice_date: dateFor("invoice\\s*date") || parseInvoiceDate(text.match(new RegExp(`\\bINVOICE\\s+[A-Z0-9/-]+\\s+DATE\\s*[:#-]?\\s*(${datePattern})`, "i"))?.[1] || ""),
    due_date: dateFor("due\\s*date"),
    amount: Number.isFinite(amount) ? amount : 0,
  };
}
function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Date(value + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function missingInvoiceFields(draft: InvoiceDraft) {
  const missing: string[] = [];
  if (!draft.vendor.trim()) missing.push("Vendor");
  if (!draft.description.trim()) missing.push("Description");
  if (!draft.due_date) missing.push("Due date");
  if (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) missing.push("Amount");
  if (draft.status === "paid" && !draft.paid_at) missing.push("Payment date");
  return missing;
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
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [breakdownBy, setBreakdownBy] = useState<"vendor" | "category">("vendor");
  const [sortColumn, setSortColumn] = useState<InvoiceSortColumn>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [readingPdf, setReadingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState("");
  const [pdfDrafts, setPdfDrafts] = useState<InvoicePdfDraft[]>([]);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const invoiceFormRef = useRef<HTMLFormElement>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase.from("tech_invoices").select("id, vendor, invoice_number, account_number, billing_frequency, reminder_days_before, description, category, invoice_date, due_date, amount, status, paid_at, notes, created_at").order("due_date", { ascending: true });
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
  useEffect(() => { if (showForm) invoiceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [showForm, editing]);
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
    const nextThirtyDays = activeInvoices.flatMap((invoice) => upcomingBillDates(invoice, 30).map((date) => ({ date, amount: Number(invoice.amount || 0) })));
    const nextSixtyDays = activeInvoices.flatMap((invoice) => upcomingBillDates(invoice, 60).map((date) => ({ date, amount: Number(invoice.amount || 0) })));
    return {
      spent: spent.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      allTime: paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      openAmount: open.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      overdueAmount: overdue.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      overdueCount: overdue.length,
      nextAmount: nextThirtyDays.reduce((sum, bill) => sum + bill.amount, 0),
      nextCount: nextThirtyDays.length,
      nextSixtyAmount: nextSixtyDays.reduce((sum, bill) => sum + bill.amount, 0),
      nextSixtyCount: nextSixtyDays.length,
      openCount: open.length,
    };
  }, [activeInvoices, paidInvoices, yearFilter]);

  const billingReminders = useMemo(() => activeInvoices.flatMap((invoice) => {
    if (!invoice.reminder_days_before) return [];
    return upcomingBillDates(invoice, invoice.reminder_days_before).map((dueDate) => ({
      id: `${invoice.id}-${dueDate}`,
      vendor: invoice.vendor,
      description: invoice.description,
      category: invoice.category,
      billing_frequency: invoice.billing_frequency,
      dueDate,
      amount: Number(invoice.amount || 0),
    }));
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.vendor.localeCompare(b.vendor)), [activeInvoices]);

  const spendingBreakdown = useMemo(() => {
    const query = search.trim().toLowerCase();
    const groups = new Map<string, { paid: number; open: number }>();
    for (const invoice of activeInvoices) {
      const matchesSearch = !query || [invoice.vendor, invoice.invoice_number, invoice.account_number, invoice.billing_frequency === "one_time" ? "" : billingFrequencyLabels[invoice.billing_frequency], invoice.description, invoice.category].some((value) => String(value || "").toLowerCase().includes(query));
      if (!matchesSearch || (categoryFilter !== "all" && invoice.category !== categoryFilter)) continue;
      const key = breakdownBy === "vendor" ? invoice.vendor : invoice.category || "Other";
      const group = groups.get(key) || { paid: 0, open: 0 };
      if (invoice.status === "paid" && (yearFilter === "all" || invoice.paid_at?.startsWith(yearFilter))) group.paid += Number(invoice.amount || 0);
      if (invoice.status === "open" && (yearFilter === "all" || invoice.due_date.startsWith(yearFilter))) group.open += Number(invoice.amount || 0);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .map(([name, amounts]) => ({ name, ...amounts, total: amounts.paid + amounts.open }))
      .filter((group) => group.total > 0)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [activeInvoices, breakdownBy, categoryFilter, search, yearFilter]);

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = invoices.filter((invoice) => {
      const matchesSearch = !query || [invoice.vendor, invoice.invoice_number, invoice.account_number, invoice.billing_frequency === "one_time" ? "" : billingFrequencyLabels[invoice.billing_frequency], invoice.description, invoice.category].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = statusFilter === "all" || invoice.status === statusFilter || (statusFilter === "overdue" && invoice.status === "open" && invoice.due_date < today());
      const matchesYear = yearFilter === "all" || invoice.due_date.startsWith(yearFilter) || Boolean(invoice.paid_at?.startsWith(yearFilter));
      const matchesCategory = categoryFilter === "all" || invoice.category === categoryFilter;
      return matchesSearch && matchesStatus && matchesYear && matchesCategory;
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    return matching.sort((a, b) => {
      let comparison = 0;
      if (sortColumn === "vendor") {
        comparison = a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" });
        if (!comparison) comparison = (a.invoice_number || "").localeCompare(b.invoice_number || "", undefined, { numeric: true, sensitivity: "base" });
      } else if (sortColumn === "due_date") {
        comparison = a.due_date.localeCompare(b.due_date);
      } else if (sortColumn === "amount") {
        comparison = Number(a.amount) - Number(b.amount);
      } else {
        const statusLabel = (invoice: Invoice) => invoice.status === "open" && invoice.due_date < today() ? "Overdue" : invoice.status === "open" ? "Open" : invoice.status === "paid" ? "Paid" : "Void";
        comparison = statusLabel(a).localeCompare(statusLabel(b), undefined, { sensitivity: "base" });
      }
      return comparison * direction || a.due_date.localeCompare(b.due_date);
    });
  }, [invoices, search, statusFilter, yearFilter, categoryFilter, sortColumn, sortDirection]);

  function toggleSort(column: InvoiceSortColumn) {
    if (sortColumn === column) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function sortIndicator(column: InvoiceSortColumn) {
    if (sortColumn !== column) return "↕";
    if (column === "vendor" || column === "status") return sortDirection === "asc" ? "↑ A–Z" : "↓ Z–A";
    if (column === "amount") return sortDirection === "asc" ? "↑ Low–High" : "↓ High–Low";
    return sortDirection === "asc" ? "↑ Earliest" : "↓ Latest";
  }

  function startNew() {
    setEditing(null);
    setDraft({ ...emptyDraft, invoice_date: today() });
    setError("");
    setShowForm(true);
  }
  async function importInvoicePdfs(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setReadingPdf(true);
    setError("");
    setNotice("");
    setPdfProgress(`Preparing ${files.length} PDF${files.length === 1 ? "" : "s"}…`);
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
      const imported: InvoicePdfDraft[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setPdfProgress(`Reading ${index + 1} of ${files.length}: ${file.name}`);
        const item: InvoicePdfDraft = { id: crypto.randomUUID(), fileName: file.name, draft: { ...emptyDraft, invoice_date: today() }, issue: "" };
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          item.issue = "This file is not a PDF. You can remove it or enter the invoice details manually.";
          imported.push(item);
          continue;
        }
        if (file.size > 15 * 1024 * 1024) {
          item.issue = "This PDF is over 15 MB. You can remove it or enter the invoice details manually.";
          imported.push(item);
          continue;
        }
        try {
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
          const pageTexts: string[] = [];
          for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 20); pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            pageTexts.push(content.items.map((entry) => "str" in entry ? entry.str : "").join(" "));
          }
          const text = pageTexts.join("\n");
          if (!text.trim()) throw new Error("No selectable text found. Enter the invoice details below or remove this file.");
          const extracted = extractInvoiceFields(text);
          item.draft = { ...emptyDraft, ...extracted, category: "Software", invoice_date: extracted.invoice_date || today() };
        } catch (pdfError) {
          item.issue = pdfError instanceof Error ? pdfError.message : "Unable to read this PDF. Enter the invoice details manually.";
        }
        imported.push(item);
      }
      setPdfDrafts((current) => [...current, ...imported]);
      setNotice(`${imported.length} PDF${imported.length === 1 ? "" : "s"} added for review. Check the extracted details before saving.`);
      setShowForm(false);
      setEditing(null);
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : "Unable to read the selected PDFs.");
    } finally {
      setReadingPdf(false);
      setPdfProgress("");
    }
  }
  function updatePdfDraft(id: string, changes: Partial<InvoiceDraft>) {
    setPdfDrafts((current) => current.map((item) => item.id === id ? { ...item, draft: { ...item.draft, ...changes } } : item));
  }
  async function savePdfBatch() {
    if (!pdfDrafts.length || pdfDrafts.some(({ draft }) => missingInvoiceFields(draft).length > 0)) return;
    setSaving(true);
    setError("");
    setNotice("");
    const payload = pdfDrafts.map(({ draft }) => ({ ...draft, vendor: draft.vendor.trim(), invoice_number: draft.invoice_number.trim() || null, account_number: draft.account_number.trim() || null, description: draft.description.trim(), category: draft.category.trim() || "Software", invoice_date: draft.invoice_date || null, due_date: draft.due_date, amount: Number(draft.amount), paid_at: draft.status === "paid" ? draft.paid_at || today() : null, notes: draft.notes.trim() || null, updated_at: new Date().toISOString() }));
    const { error: saveError } = await supabase.from("tech_invoices").insert(payload);
    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }
    const savedCount = pdfDrafts.length;
    setPdfDrafts([]);
    setNotice(`${savedCount} invoice${savedCount === 1 ? "" : "s"} added.`);
    await loadInvoices();
    setSaving(false);
  }
  function startEdit(invoice: Invoice) {
    setEditing(invoice.id);
    setDraft({ vendor: invoice.vendor, invoice_number: invoice.invoice_number || "", account_number: invoice.account_number || "", billing_frequency: invoice.billing_frequency || "one_time", reminder_days_before: invoice.reminder_days_before ?? 30, description: invoice.description, category: invoice.category || "Other", invoice_date: invoice.invoice_date || "", due_date: invoice.due_date, amount: Number(invoice.amount), status: invoice.status === "paid" ? "paid" : "open", paid_at: invoice.paid_at || "", notes: invoice.notes || "" });
    setError("");
    setShowForm(true);
  }
  async function saveInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const payload = { ...draft, vendor: draft.vendor.trim(), invoice_number: draft.invoice_number.trim() || null, account_number: draft.account_number.trim() || null, description: draft.description.trim(), category: draft.category.trim() || "Software", invoice_date: draft.invoice_date || null, due_date: draft.due_date, amount: Number(draft.amount), paid_at: draft.status === "paid" ? draft.paid_at : null, notes: draft.notes.trim() || null, updated_at: new Date().toISOString() };
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
      <div className="invoice-actions"><p>Enter invoices as they arrive, then mark them paid when they clear.</p><div className="invoice-import-actions"><input ref={pdfInputRef} className="sr-only" type="file" accept="application/pdf,.pdf" multiple onChange={importInvoicePdfs} /><button type="button" className="secondary-link" disabled={readingPdf} onClick={() => pdfInputRef.current?.click()}>{readingPdf ? "Reading PDFs…" : "Upload invoice PDFs"}</button><button type="button" className="primary-link" onClick={startNew}>＋ Add invoice</button></div></div>
      {error && <div className="alert alert-error" role="alert">{sqlMessage || error}</div>}
      {notice && <div className="invoice-notice" role="status">{notice}</div>}
      {readingPdf && <div className="invoice-notice" role="status">{pdfProgress}</div>}

      {showForm && <form ref={invoiceFormRef} className="invoice-form" onSubmit={saveInvoice}>
        <div className="invoice-form-heading"><div><p className="eyebrow">{editing ? "Update record" : "New record"}</p><h2>{editing ? "Edit invoice" : "Add a tech invoice"}</h2></div><button type="button" className="text-button" onClick={() => setShowForm(false)}>Cancel</button></div>
        <div className="invoice-form-grid">
          <label>Vendor<input required maxLength={120} value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} placeholder="e.g. Internet provider" /></label>
          <label>Invoice number <span className="optional">(optional)</span><input maxLength={80} value={draft.invoice_number} onChange={(e) => setDraft({ ...draft, invoice_number: e.target.value })} /></label>
          <label>Account number <span className="optional">(optional)</span><input maxLength={80} value={draft.account_number} onChange={(e) => setDraft({ ...draft, account_number: e.target.value })} /></label>
          <label>Description<input required maxLength={180} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Service, equipment, or subscription" /></label>
          <label>Billing frequency<select value={draft.billing_frequency} onChange={(e) => setDraft({ ...draft, billing_frequency: e.target.value as BillingFrequency })}><option value="one_time">One-time</option><option value="monthly">Monthly</option><option value="biweekly">Biweekly (every 2 weeks)</option><option value="yearly">Yearly</option></select></label>
          <label>Remind me<select value={draft.reminder_days_before} onChange={(e) => setDraft({ ...draft, reminder_days_before: Number(e.target.value) })}><option value={0}>Off</option><option value={7}>7 days before</option><option value={14}>14 days before</option><option value={30}>30 days before</option><option value={60}>60 days before</option></select></label>
          <label>Category<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{!invoiceCategories.includes(draft.category) && <option>{draft.category}</option>}{invoiceCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>Invoice date<input type="date" value={draft.invoice_date} onChange={(e) => setDraft({ ...draft, invoice_date: e.target.value })} /></label>
          <label>Due date<input required type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></label>
          <label>Amount<input required type="number" min="0.01" step="0.01" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} placeholder="0.00" /></label>
          <label>Payment status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as "open" | "paid", paid_at: e.target.value === "paid" ? draft.paid_at || today() : "" })}><option value="open">Unpaid</option><option value="paid">Paid</option></select></label>
          {draft.status === "paid" && <label>Payment date<input required type="date" value={draft.paid_at} onChange={(e) => setDraft({ ...draft, paid_at: e.target.value })} /></label>}
          <label className="invoice-notes-field">Notes <span className="optional">(optional)</span><textarea rows={2} maxLength={1000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
        </div>
        {error && !sqlMessage && <div className="alert alert-error">{error}</div>}
        <div className="invoice-form-footer"><span>Invoice details are limited to authorized accounts.</span><button className="primary-link" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save invoice"}</button></div>
      </form>}

      {pdfDrafts.length > 0 && <section className="invoice-batch" aria-labelledby="invoice-batch-title">
        <div className="invoice-batch-heading"><div><p className="eyebrow">PDF batch import · {pdfDrafts.length} invoice{pdfDrafts.length === 1 ? "" : "s"}</p><h2 id="invoice-batch-title">Review invoices before saving</h2><p>Check every field. The PDFs stay in your browser and are not saved to the tracker.</p></div><div className="invoice-batch-actions"><button type="button" className="secondary-link" disabled={readingPdf} onClick={() => pdfInputRef.current?.click()}>＋ Add more PDFs</button><button type="button" className="text-button" onClick={() => setPdfDrafts([])}>Clear batch</button></div></div>
        <div className="invoice-batch-list">{pdfDrafts.map((item, index) => {
          const missingFields = missingInvoiceFields(item.draft);
          return <article className={"invoice-batch-card" + (missingFields.length ? " has-missing-fields" : "")} key={item.id}>
          <div className="invoice-batch-card-heading"><div><span className="invoice-batch-count">Invoice {index + 1} of {pdfDrafts.length}</span><strong title={item.fileName}>{item.fileName}</strong></div><button type="button" className="text-button" onClick={() => setPdfDrafts((current) => current.filter((entry) => entry.id !== item.id))}>Remove</button></div>
          {item.issue && <p className="invoice-batch-issue" role="status">{item.issue}</p>}
          {missingFields.length > 0 && <p className="invoice-batch-missing" role="status">Needs: {missingFields.join(", ")}</p>}
          <div className="invoice-batch-grid">
            <label>Vendor<input required maxLength={120} value={item.draft.vendor} onChange={(e) => updatePdfDraft(item.id, { vendor: e.target.value })} placeholder="e.g. LoadTrek" /></label>
            <label>Invoice number <span className="optional">(optional)</span><input maxLength={80} value={item.draft.invoice_number} onChange={(e) => updatePdfDraft(item.id, { invoice_number: e.target.value })} /></label>
            <label>Account number <span className="optional">(optional)</span><input maxLength={80} value={item.draft.account_number} onChange={(e) => updatePdfDraft(item.id, { account_number: e.target.value })} /></label>
            <label>Description<input required maxLength={180} value={item.draft.description} onChange={(e) => updatePdfDraft(item.id, { description: e.target.value })} placeholder="Service, equipment, or subscription" /></label>
            <label>Billing frequency<select value={item.draft.billing_frequency} onChange={(e) => updatePdfDraft(item.id, { billing_frequency: e.target.value as BillingFrequency })}><option value="one_time">One-time</option><option value="monthly">Monthly</option><option value="biweekly">Biweekly (every 2 weeks)</option><option value="yearly">Yearly</option></select></label>
            <label>Remind me<select value={item.draft.reminder_days_before} onChange={(e) => updatePdfDraft(item.id, { reminder_days_before: Number(e.target.value) })}><option value={0}>Off</option><option value={7}>7 days before</option><option value={14}>14 days before</option><option value={30}>30 days before</option><option value={60}>60 days before</option></select></label>
            <label>Category<select value={item.draft.category} onChange={(e) => updatePdfDraft(item.id, { category: e.target.value })}>{invoiceCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Invoice date<input type="date" value={item.draft.invoice_date} onChange={(e) => updatePdfDraft(item.id, { invoice_date: e.target.value })} /></label>
            <label>Due date<input required type="date" value={item.draft.due_date} onChange={(e) => updatePdfDraft(item.id, { due_date: e.target.value })} /></label>
            <label>Amount<input required type="number" min="0.01" step="0.01" value={item.draft.amount || ""} onChange={(e) => updatePdfDraft(item.id, { amount: Number(e.target.value) })} placeholder="0.00" /></label>
            <label>Payment status<select value={item.draft.status} onChange={(e) => updatePdfDraft(item.id, { status: e.target.value as "open" | "paid", paid_at: e.target.value === "paid" ? item.draft.paid_at || today() : "" })}><option value="open">Unpaid</option><option value="paid">Paid</option></select></label>
            {item.draft.status === "paid" && <label>Payment date<input required type="date" value={item.draft.paid_at} onChange={(e) => updatePdfDraft(item.id, { paid_at: e.target.value })} /></label>}
            <label className="invoice-batch-notes">Notes <span className="optional">(optional)</span><textarea rows={2} maxLength={1000} value={item.draft.notes} onChange={(e) => updatePdfDraft(item.id, { notes: e.target.value })} /></label>
          </div>
        </article>})}</div>
        {error && !sqlMessage && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="invoice-batch-footer"><span>{pdfDrafts.some(({ draft }) => missingInvoiceFields(draft).length > 0) ? `Review the highlighted invoices above. ${pdfDrafts.filter(({ draft }) => missingInvoiceFields(draft).length > 0).length} still need required details.` : "All invoice details are ready to save."}</span><button type="button" className="primary-link" disabled={saving || pdfDrafts.some(({ draft }) => missingInvoiceFields(draft).length > 0)} onClick={() => void savePdfBatch()}>{saving ? "Saving invoices…" : `Save ${pdfDrafts.length} invoice${pdfDrafts.length === 1 ? "" : "s"}`}</button></div>
      </section>}

      {billingReminders.length > 0 && <section className="invoice-reminders" aria-labelledby="invoice-reminders-title">
        <div><p className="eyebrow">Coming up</p><h2 id="invoice-reminders-title">Billing reminders</h2><p>Upcoming bills are shown based on each invoice’s reminder setting.</p></div>
        <ul className="invoice-reminder-list">{billingReminders.map((bill) => <li key={bill.id}>
          <div><strong>{bill.vendor}</strong><span>{bill.description} · {billingFrequencyLabels[bill.billing_frequency]}</span></div>
          <div><strong>{money.format(bill.amount)}</strong><span>{dateLabel(bill.dueDate)} · {daysUntilLabel(bill.dueDate)}</span></div>
        </li>)}</ul>
      </section>}

      <div className="invoice-metrics" aria-label="Invoice summary">
        <article><span>Paid in {yearFilter === "all" ? "all years" : yearFilter}</span><strong>{money.format(summary.spent)}</strong><small>Counted by payment date</small></article>
        <article><span>Paid all time</span><strong>{money.format(summary.allTime)}</strong><small>Excludes open and void invoices</small></article>
        <article><span>Open balance</span><strong>{money.format(summary.openAmount)}</strong><small>{summary.openCount} unpaid invoices</small></article>
        <article className={summary.overdueCount ? "is-overdue" : ""}><span>Past due</span><strong>{money.format(summary.overdueAmount)}</strong><small>{summary.overdueCount} overdue invoices</small></article>
        <article><span>Due in the next 30 days</span><strong>{money.format(summary.nextAmount)}</strong><small>{summary.nextCount} upcoming bills</small></article>
        <article><span>Due in the next 60 days</span><strong>{money.format(summary.nextSixtyAmount)}</strong><small>{summary.nextSixtyCount} upcoming bills, including the first 30 days</small></article>
      </div>

      <section className="invoice-breakdown" aria-labelledby="invoice-breakdown-title">
        <div className="invoice-breakdown-heading">
          <div><p className="eyebrow">Spending breakdown · {yearFilter === "all" ? "All years" : yearFilter}</p><h2 id="invoice-breakdown-title">Costs by {breakdownBy === "vendor" ? "vendor" : "category"}</h2></div>
          <label>Group by<select value={breakdownBy} onChange={(e) => setBreakdownBy(e.target.value as "vendor" | "category")}><option value="vendor">Vendor</option><option value="category">Category</option></select></label>
        </div>
        <div className="invoice-table-wrap">
          {spendingBreakdown.length === 0 ? <p className="invoice-empty">No costs match the current search, category, and year.</p> : (
            <table className="invoice-table"><thead><tr><th>{breakdownBy === "vendor" ? "Vendor" : "Category"}</th><th>Paid</th><th>Unpaid</th><th>Total billed</th></tr></thead>
              <tbody>{spendingBreakdown.map((group) => <tr key={group.name}><td><strong>{group.name}</strong></td><td className="invoice-amount">{money.format(group.paid)}</td><td>{money.format(group.open)}</td><td className="invoice-amount">{money.format(group.total)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <p className="invoice-breakdown-note">Paid totals use payment date; unpaid totals use due date. Voided invoices are excluded. Search and category filters apply to this breakdown.</p>
      </section>



      <div className="invoice-list-heading"><div><p className="eyebrow">Invoice register</p><h2>Invoices</h2></div>
        <div className="invoice-filters">
          <label className="sr-only" htmlFor="invoice-search">Search invoices</label><input id="invoice-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor or invoice" />
          <label className="sr-only" htmlFor="invoice-status">Invoice status</label><select id="invoice-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="open">Open</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option><option value="all">All statuses</option></select>
          <label className="sr-only" htmlFor="invoice-year">Invoice year</label><select id="invoice-year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}><option value="all">All years</option>{yearOptions.map((year) => <option value={year} key={year}>{year}</option>)}</select>
          <label className="sr-only" htmlFor="invoice-category">Invoice category</label><select id="invoice-category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="all">All categories</option>{invoiceCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select>
        </div>
      </div>
      <div className="invoice-table-wrap">
        {loading ? <p className="invoice-empty">Loading invoices…</p> : filteredInvoices.length === 0 ? <div className="invoice-empty"><strong>No invoices match these filters.</strong><span>Add an invoice to start tracking due dates and spend.</span></div> : (
          <table className="invoice-table"><thead><tr>
            <th aria-sort={sortColumn === "vendor" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="invoice-sort-button" aria-label={`Sort by vendor and invoice ${sortColumn === "vendor" ? (sortDirection === "asc" ? "Z to A" : "A to Z") : "A to Z"}`} onClick={() => toggleSort("vendor")}>Vendor / invoice <span aria-hidden="true">{sortIndicator("vendor")}</span></button></th>
            <th>Description</th>
            <th aria-sort={sortColumn === "due_date" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="invoice-sort-button" aria-label={`Sort by due date ${sortColumn === "due_date" ? (sortDirection === "asc" ? "latest first" : "earliest first") : "earliest first"}`} onClick={() => toggleSort("due_date")}>Due date <span aria-hidden="true">{sortIndicator("due_date")}</span></button></th>
            <th aria-sort={sortColumn === "amount" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="invoice-sort-button" aria-label={`Sort by amount ${sortColumn === "amount" ? (sortDirection === "asc" ? "highest first" : "lowest first") : "lowest first"}`} onClick={() => toggleSort("amount")}>Amount <span aria-hidden="true">{sortIndicator("amount")}</span></button></th>
            <th aria-sort={sortColumn === "status" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="invoice-sort-button" aria-label={`Sort by status ${sortColumn === "status" ? (sortDirection === "asc" ? "Z to A" : "A to Z") : "A to Z"}`} onClick={() => toggleSort("status")}>Status <span aria-hidden="true">{sortIndicator("status")}</span></button></th>
            <th>Actions</th></tr></thead>
            <tbody>{filteredInvoices.map((invoice) => {
              const overdue = invoice.status === "open" && invoice.due_date < today();
              return <tr key={invoice.id}>
                <td><strong>{invoice.vendor}</strong><span>{invoice.invoice_number || "No invoice number"}</span>{invoice.account_number && <span>Account {invoice.account_number}</span>}</td>
                <td><strong>{invoice.description}</strong><span>{invoice.category}{invoice.billing_frequency !== "one_time" ? " · " + billingFrequencyLabels[invoice.billing_frequency] : ""}{invoice.notes ? " · " + invoice.notes : ""}</span></td>
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
  ".invoice-import-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.secondary-link{min-height:42px;padding:9px 13px;border:1px solid #b9c8d6;border-radius:7px;background:#fff;color:#244969;font:inherit;font-size:.84rem;font-weight:800;cursor:pointer}.secondary-link:hover{background:#eff4f8}.secondary-link:disabled{opacity:.6;cursor:wait}",
  ".invoice-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.invoice-metrics article{display:grid;gap:7px;padding:17px;border:1px solid #dce3ea;border-radius:11px;background:white;box-shadow:0 5px 18px #142d4608}.invoice-metrics article span{font-size:.74rem;font-weight:800;letter-spacing:.045em;text-transform:uppercase;color:#647487}.invoice-metrics article strong{font-size:1.45rem;color:#123a60;letter-spacing:-.03em}.invoice-metrics article small{font-size:.74rem;color:#728090;line-height:1.35}.invoice-metrics article.is-overdue{border-color:#e6c5c8;background:#fffafa}.invoice-metrics article.is-overdue strong{color:#9b343c}",
  ".invoice-notice{padding:12px 15px;border-radius:8px;background:#e8f3ec;color:#225c39;font-weight:700}
  ".invoice-reminders{display:grid;gap:12px;padding:18px;border:1px solid #d6e2eb;border-radius:11px;background:#f8fbfd}.invoice-reminders h2{margin:3px 0;color:#0b3158;font-size:1.2rem}.invoice-reminders p:not(.eyebrow){margin:5px 0 0;color:#6e7d8b;font-size:.82rem}.invoice-reminder-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.invoice-reminder-list li{display:flex;justify-content:space-between;gap:16px;padding:11px 12px;border:1px solid #dce3ea;border-radius:8px;background:#fff}.invoice-reminder-list li div{display:grid;gap:3px}.invoice-reminder-list li div:last-child{text-align:right}.invoice-reminder-list strong{color:#173b62;font-size:.86rem}.invoice-reminder-list span{color:#718090;font-size:.76rem;line-height:1.35}@media(max-width:600px){.invoice-reminder-list li{align-items:flex-start;flex-direction:column}.invoice-reminder-list li div:last-child{text-align:left}}.invoice-form{padding:22px;border:1px solid #d7e0e8;border-radius:12px;background:white;box-shadow:0 8px 26px #142d460a}.invoice-form-heading,.invoice-form-footer{display:flex;align-items:center;justify-content:space-between;gap:14px}.invoice-form-heading{margin-bottom:18px}.invoice-form-heading h2,.invoice-list-heading h2{margin:3px 0;color:#0b3158;font-size:1.35rem}",
  ".invoice-batch{display:grid;gap:14px;padding:20px;border:1px solid #c9d8e4;border-radius:12px;background:#f8fbfd}.invoice-batch-heading,.invoice-batch-actions,.invoice-batch-card-heading,.invoice-batch-footer{display:flex;align-items:center;justify-content:space-between;gap:14px}.invoice-batch-heading h2{margin:3px 0;color:#0b3158;font-size:1.3rem}.invoice-batch-heading p:not(.eyebrow){margin:5px 0 0;color:#6e7d8b;font-size:.84rem}.invoice-batch-actions{flex-wrap:wrap}.invoice-batch-list{display:grid;gap:12px}.invoice-batch-card{display:grid;gap:13px;padding:16px;border:1px solid #dce3ea;border-radius:10px;background:#fff}.invoice-batch-card.has-missing-fields{border-color:#e3bf7b;background:#fffefa}.invoice-batch-card-heading>div{display:grid;gap:3px;min-width:0}.invoice-batch-card-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#243b52;font-size:.9rem}.invoice-batch-count{color:#758494;font-size:.72rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.invoice-batch-issue{margin:0;padding:9px 11px;border-radius:7px;background:#fff5e8;color:#76521c;font-size:.8rem}.invoice-batch-missing{margin:0;padding:8px 10px;border-radius:7px;background:#fff0d7;color:#76521c;font-size:.78rem;font-weight:800}.invoice-batch-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.invoice-batch-grid label{display:grid;gap:5px;color:#34495e;font-size:.8rem;font-weight:700}.invoice-batch-grid input,.invoice-batch-grid select,.invoice-batch-grid textarea{width:100%;min-height:40px;border:1px solid #bdc9d4;border-radius:7px;background:#fff;padding:8px 10px;color:#172b3f;font:inherit}.invoice-batch-grid textarea{resize:vertical}.invoice-batch-notes{grid-column:span 2}.invoice-batch-footer{padding-top:12px;border-top:1px solid #dce3ea}.invoice-batch-footer span{color:#6e7d8b;font-size:.8rem}.invoice-batch-footer button:disabled{opacity:.55;cursor:wait}",
  ".invoice-breakdown{display:grid;gap:10px;padding:18px;border:1px solid #dce3ea;border-radius:11px;background:white}.invoice-breakdown-heading{display:flex;justify-content:space-between;align-items:end;gap:16px}.invoice-breakdown-heading h2{margin:3px 0;color:#0b3158;font-size:1.25rem}.invoice-breakdown-heading label{display:flex;align-items:center;gap:8px;color:#5d6d7c;font-size:.8rem;font-weight:700}.invoice-breakdown-heading select{min-height:38px;border:1px solid #bdc9d4;border-radius:7px;padding:7px 10px;background:white;color:#172b3f;font:inherit}.invoice-breakdown-note{margin:0;color:#728090;font-size:.76rem}",
  ".invoice-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.invoice-form-grid label{display:grid;gap:6px;color:#34495e;font-size:.82rem;font-weight:700}.invoice-form-grid input,.invoice-form-grid select,.invoice-form-grid textarea,.invoice-filters input,.invoice-filters select{width:100%;min-height:42px;border:1px solid #bdc9d4;border-radius:7px;background:#fff;padding:9px 11px;color:#172b3f;font:inherit}.invoice-form-grid textarea{resize:vertical}.invoice-notes-field{grid-column:span 2}.optional{color:#8290a0;font-weight:400}.invoice-form-footer{margin-top:18px;padding-top:14px;border-top:1px solid #e5e9ed}.invoice-form-footer span{font-size:.78rem;color:#718090}.invoice-form-footer button:disabled{opacity:.55;cursor:wait}",
  ".invoice-list-heading{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-top:12px}.invoice-filters{display:flex;gap:8px;align-items:center}.invoice-filters input{min-width:220px}.invoice-filters select{width:auto;min-width:125px}",
  ".invoice-table-wrap{overflow-x:auto;border:1px solid #dce3ea;border-radius:10px;background:white}.invoice-table{width:100%;border-collapse:collapse;text-align:left}.invoice-table th{padding:12px 14px;background:#f1f5f8;color:#5d6d7c;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.invoice-table td{padding:13px 14px;border-top:1px solid #e7ebef;vertical-align:middle;font-size:.86rem}.invoice-table td strong,.invoice-table td span{display:block}.invoice-table td span{margin-top:4px;color:#748292;font-size:.75rem;max-width:330px;white-space:normal;line-height:1.4}.invoice-table .invoice-amount{font-weight:800;color:#173b62;white-space:nowrap}",
  ".invoice-sort-button{display:inline-flex;align-items:center;gap:6px;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer}.invoice-sort-button span{color:#244969;font-size:.68rem}.invoice-sort-button:hover,.invoice-sort-button:focus-visible{color:#0b3158;text-decoration:underline;text-underline-offset:3px;outline:none}",
  ".invoice-status{display:inline-flex!important;width:max-content;border-radius:999px;padding:5px 9px;background:#fff1dc;color:#825916!important;font-weight:800}.invoice-status.paid{background:#e4f2e9;color:#286343!important}.invoice-status.overdue{background:#fae5e6;color:#9b343c!important}.invoice-status.void{background:#e9edf1;color:#687787!important}.invoice-row-actions{display:flex;gap:6px;flex-wrap:wrap}.invoice-row-actions button{border:1px solid #d3dce4;border-radius:6px;padding:6px 8px;background:#fff;color:#244969;font-size:.74rem;font-weight:700;cursor:pointer;white-space:nowrap}.invoice-row-actions button:hover{background:#eff4f8}.invoice-row-actions .void-action{color:#8b3d42}",
  ".invoice-empty{display:grid;gap:6px;justify-items:center;padding:36px 16px;color:#647487}.invoice-empty strong{color:#34495e}.invoice-empty span{font-size:.84rem}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
  "@media(max-width:1050px){.invoice-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.invoice-list-heading{align-items:stretch;flex-direction:column}.invoice-filters{flex-wrap:wrap}.invoice-filters input{flex:1;min-width:180px}.invoice-batch-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.invoice-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.invoice-form-grid{grid-template-columns:1fr}.invoice-notes-field{grid-column:auto}.invoice-actions{align-items:stretch;flex-direction:column}.invoice-actions .primary-link{align-self:flex-start}.invoice-import-actions{align-self:flex-start}.invoice-filters input{flex-basis:100%}.invoice-filters select{flex:1}.invoice-form-footer{align-items:flex-start;flex-direction:column}.invoice-breakdown-heading{align-items:flex-start;flex-direction:column}.invoice-batch-heading,.invoice-batch-card-heading,.invoice-batch-footer{align-items:flex-start;flex-direction:column}.invoice-batch-grid{grid-template-columns:1fr}.invoice-batch-notes{grid-column:auto}.invoice-batch-actions{width:100%;justify-content:flex-start}}",
].join("");
