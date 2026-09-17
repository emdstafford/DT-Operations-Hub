"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type OperationalNote = {
  id: string;
  contract_number: string;
  trip_number: string | null;
  status: "waiting_on_usps" | "monitoring" | "resolved";
  note: string;
  requested_on: string | null;
  effective_start: string;
  effective_end: string | null;
  created_at: string;
};

const statusLabel = (status: OperationalNote["status"]) => status === "waiting_on_usps"
  ? "Waiting on USPS"
  : status === "monitoring" ? "Monitoring" : "Resolved";

export default function ContractOperationalNotes({ contract }: { contract: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [notes, setNotes] = useState<OperationalNote[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [trip, setTrip] = useState("");
  const [status, setStatus] = useState<"waiting_on_usps" | "monitoring">("waiting_on_usps");
  const [requestedOn, setRequestedOn] = useState("");
  const [effectiveStart, setEffectiveStart] = useState(today);
  const [note, setNote] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadNotes = useCallback(async () => {
    const { data, error: notesError } = await supabase
      .from("operational_notes")
      .select("id,contract_number,trip_number,status,note,requested_on,effective_start,effective_end,created_at")
      .eq("contract_number", contract)
      .order("effective_start", { ascending: false });
    if (notesError) {
      setError(notesError.message.includes("operational_notes") ? "Operational notes need the Supabase database update before they can be used." : notesError.message);
      return;
    }
    setNotes((data ?? []) as OperationalNote[]);
  }, [contract]);

  useEffect(() => {
    void loadNotes();
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email?.toLowerCase();
      if (!email) return;
      const { data } = await supabase.from("approved_users").select("role").eq("email", email).eq("active", true).maybeSingle();
      setCanEdit(data?.role === "admin" || data?.role === "uploader");
    })();
  }, [loadNotes]);

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) return;
    setSaving(true); setError("");
    const { error: saveError } = await supabase.from("operational_notes").insert({
      contract_number: contract,
      trip_number: trip.trim() || null,
      status,
      note: note.trim(),
      requested_on: requestedOn || null,
      effective_start: effectiveStart,
    });
    if (saveError) setError(saveError.message);
    else {
      setTrip(""); setRequestedOn(""); setEffectiveStart(today); setNote(""); setStatus("waiting_on_usps"); setShowForm(false);
      await loadNotes();
    }
    setSaving(false);
  }

  async function resolveNote(id: string) {
    setSaving(true); setError("");
    const { error: resolveError } = await supabase.from("operational_notes").update({
      status: "resolved",
      effective_end: today,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (resolveError) setError(resolveError.message);
    else await loadNotes();
    setSaving(false);
  }

  const active = notes.filter((item) => item.status !== "resolved" && !item.effective_end);
  const resolved = notes.filter((item) => item.status === "resolved" || item.effective_end);

  return <section className="panel operational-notes-panel no-print">
    <div className="panel-heading operational-notes-heading">
      <div><p className="eyebrow">Saved operational context</p><h2>Contract and trip notes</h2><span>Document known causes so the same missed-stop issue does not have to be researched again.</span></div>
      {canEdit && <button type="button" className="primary-link" onClick={() => setShowForm((value) => !value)}>{showForm ? "Cancel" : "Add note"}</button>}
    </div>
    {error && <div className="alert alert-error">{error}</div>}
    {showForm && canEdit && <form className="operational-note-form" onSubmit={saveNote}>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as "waiting_on_usps" | "monitoring")}><option value="waiting_on_usps">Waiting on USPS</option><option value="monitoring">Monitoring</option></select></label>
      <label>Trip number <span>(optional)</span><input value={trip} onChange={(event) => setTrip(event.target.value)} placeholder="Example: 33" /></label>
      <label>Requested from USPS <span>(optional)</span><input type="date" value={requestedOn} onChange={(event) => setRequestedOn(event.target.value)} /></label>
      <label>Applies beginning<input type="date" value={effectiveStart} onChange={(event) => setEffectiveStart(event.target.value)} required /></label>
      <label className="operational-note-text">What is happening?<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: Service change requested to remove this stop; waiting for USPS to update the schedule." required rows={3} /></label>
      <button type="submit" className="primary-link" disabled={saving}>{saving ? "Saving…" : "Save operational note"}</button>
    </form>}
    {active.length ? <div className="operational-note-list">{active.map((item) => <article key={item.id}>
      <div><span className={`operational-status status-${item.status}`}>{statusLabel(item.status)}</span><strong>{item.trip_number ? `Trip ${item.trip_number}` : "Entire contract"}</strong><small>Applies from {item.effective_start}{item.requested_on ? ` · USPS requested ${item.requested_on}` : ""}</small></div>
      <p>{item.note}</p>
      {canEdit && <button type="button" className="clear-filters" disabled={saving} onClick={() => void resolveNote(item.id)}>Mark resolved</button>}
    </article>)}</div> : !error && <div className="location-empty">No active operational notes for this contract.</div>}
    {resolved.length > 0 && <details className="resolved-note-history"><summary>View {resolved.length} resolved note{resolved.length === 1 ? "" : "s"}</summary><div className="operational-note-list">{resolved.map((item) => <article key={item.id}><div><span className="operational-status status-resolved">Resolved</span><strong>{item.trip_number ? `Trip ${item.trip_number}` : "Entire contract"}</strong><small>{item.effective_start} – {item.effective_end || "Resolved"}</small></div><p>{item.note}</p></article>)}</div></details>}
  </section>;
}
