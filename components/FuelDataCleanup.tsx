"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Candidate = {
  contract_label: string; person_name: string; line_items: number; transactions: number;
  first_date: string; last_date: string; total_cost: number;
};

const currency = (value: number) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const count = (value: number) => Number(value || 0).toLocaleString("en-US");
const contractCode = (value: string) => value === "UNASSIGNED" || /^[0-9][A-Z0-9]{4,5}$/.test(value);

export default function FuelDataCleanup({ start, end, onCorrected }: { start: string; end: string; onCorrected: () => void }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [knownContracts, setKnownContracts] = useState<string[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!open || !start || !end || start > end) return;
    setLoading(true); setError(""); setSelected(null); setTarget("");
    const [candidateResult, optionResult] = await Promise.all([
      supabase.rpc("fuel_contract_cleanup_candidates", { p_start: start, p_end: end, p_all: showAll }),
      supabase.rpc("fuel_contract_cleanup_options"),
    ]);
    if (candidateResult.error || optionResult.error) {
      const issue = candidateResult.error || optionResult.error;
      setError(issue?.code === "PGRST202" || issue?.code === "42883"
        ? "Run fuel_contract_cleanup.sql in Supabase to enable corrections."
        : issue?.message || "Contract labels could not be loaded.");
      setCandidates([]);
    } else {
      setCandidates((candidateResult.data ?? []) as Candidate[]);
      setKnownContracts((optionResult.data ?? []).map((row: { contract_number: string }) => row.contract_number));
    }
    setLoading(false);
  }, [open, start, end, showAll]);

  useEffect(() => { void refresh(); }, [refresh]);
  const visible = useMemo(() => candidates.filter((row) =>
    `${row.contract_label} ${row.person_name}`.toLowerCase().includes(search.trim().toLowerCase())
  ), [candidates, search]);

  async function correct() {
    if (!selected || saving) return;
    const next = target.trim().toUpperCase();
    if (!contractCode(next) || next === selected.contract_label.trim().toUpperCase()) {
      setError("Choose a different contract number, or Unassigned, before saving."); return;
    }
    setSaving(true); setError(""); setMessage("");
    const { data, error: saveError } = await supabase.rpc("correct_fuel_contract", {
      p_old_label: selected.contract_label, p_person_name: selected.person_name,
      p_start: start, p_end: end, p_new_contract: next,
      p_expected_line_items: selected.line_items,
    });
    if (saveError) setError(saveError.message);
    else {
      setMessage(`${count(Number(data))} line items for ${selected.person_name} changed from ${selected.contract_label} to ${next === "UNASSIGNED" ? "Unassigned" : next}. Fuel totals are refreshed.`);
      await refresh();
      onCorrected();
    }
    setSaving(false);
  }

  return <details className="panel fuel-cleanup-panel no-print" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Review Comdata contract labels</summary>
    {open && <div className="fuel-cleanup-body">
      <p>Misc 2 sometimes contains a surname, job label, or another value instead of a contract. Review each person and selected date range before changing it. Original transaction amounts stay the same, and each correction is recorded.</p>
      <div className="fuel-cleanup-controls"><label>Find a label or employee<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search labels or names" /></label><label className="fuel-cleanup-all"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> Show all labels, including contract codes</label><button type="button" className="hub-secondary-link" onClick={() => void refresh()} disabled={loading}>Refresh</button></div>
      {error && <p className="alert alert-error">{error}</p>}{message && <p className="alert fuel-success">{message}</p>}
      {loading ? <p>Loading contract labels…</p> : <>
        <p className="fuel-cleanup-note">{count(visible.length)} label and employee groups shown for {start} through {end}. Review groups one at a time; some labels, such as SHUTTLE, may be intentional.</p>
        <div className="table-scroll fuel-cleanup-scroll"><table className="data-table"><thead><tr><th>Misc 2 label</th><th>Employee</th><th>Dates seen</th><th>Transactions</th><th>Line items</th><th>Cost</th><th></th></tr></thead><tbody>{visible.map((row) => <tr key={`${row.contract_label}|${row.person_name}`}><td><strong>{row.contract_label}</strong></td><td>{row.person_name}</td><td>{row.first_date} – {row.last_date}</td><td>{count(row.transactions)}</td><td>{count(row.line_items)}</td><td>{currency(row.total_cost)}</td><td><button type="button" className="hub-secondary-link" onClick={() => { setSelected(row); setTarget(""); setMessage(""); setError(""); }}>Review</button></td></tr>)}</tbody></table></div>
        {selected && <div className="fuel-cleanup-edit"><strong>Correct {selected.contract_label} for {selected.person_name}</strong><span>{count(selected.line_items)} line items · {start} through {end} · {currency(selected.total_cost)}</span><label>Move these entries to contract<input list="fuel-cleanup-contract-options" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Type or choose a contract" autoComplete="off" /></label><datalist id="fuel-cleanup-contract-options">{knownContracts.map((item) => <option key={item} value={item} />)}<option value="Unassigned" /></datalist><div className="fuel-inline-actions"><button type="button" className="primary-link" disabled={saving || !contractCode(target.trim().toUpperCase())} onClick={() => void correct()}>{saving ? "Saving…" : "Save correction"}</button><button type="button" className="hub-secondary-link" disabled={saving} onClick={() => setSelected(null)}>Cancel</button></div></div>}
      </>}
    </div>}
  </details>;
}
