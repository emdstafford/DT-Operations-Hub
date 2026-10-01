"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type LoadRow = {
  id: string;
  load_number: string;
  service_date: string;
  contract_number: string | null;
  trip_number: string | null;
  service_code: string | null;
  service_class: string;
  clear_present: boolean;
  fourkites_present: boolean;
  clear_miles: number | null;
  fourkites_miles: number | null;
  operation_status: string;
  cancellation_reason: string | null;
  payment_status: string;
};

type Filter = "all" | "matched" | "clear_only" | "fourkites_only" | "extras" | "cancelled" | "review";

const LABELS: Record<Filter, string> = {
  all: "All Loads", matched: "Both Systems", clear_only: "CLEAR Only", fourkites_only: "FourKites Only",
  extras: "Extras", cancelled: "USPS Cancelled", review: "Needs Review",
};

export default function LoadReconciliationDashboard() {
  const [rows, setRows] = useState<LoadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [contract, setContract] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true); setError("");
    const { data, error: e } = await supabase.from("load_master").select("*").order("service_date", { ascending: false }).limit(5000);
    if (e) setError(e.message); else setRows((data || []) as LoadRow[]);
    setLoading(false);
  }

  const counts = useMemo(() => ({
    all: rows.length,
    matched: rows.filter(r => r.clear_present && r.fourkites_present).length,
    clear_only: rows.filter(r => r.clear_present && !r.fourkites_present).length,
    fourkites_only: rows.filter(r => !r.clear_present && r.fourkites_present).length,
    extras: rows.filter(r => r.service_class === "extra" || r.operation_status === "extra_service").length,
    cancelled: rows.filter(r => r.operation_status === "usps_cancelled").length,
    review: rows.filter(r => r.service_class === "needs_review" || r.operation_status === "needs_review").length,
  }), [rows]);

  const contracts = useMemo(() => [...new Set(rows.map(r => r.contract_number).filter(Boolean) as string[])].sort(), [rows]);
  const visible = useMemo(() => rows.filter(r => {
    if (contract !== "all" && r.contract_number !== contract) return false;
    const q = search.trim().toLowerCase();
    if (q && ![r.load_number, r.contract_number, r.trip_number, r.service_code].some(v => String(v || "").toLowerCase().includes(q))) return false;
    if (filter === "matched") return r.clear_present && r.fourkites_present;
    if (filter === "clear_only") return r.clear_present && !r.fourkites_present;
    if (filter === "fourkites_only") return !r.clear_present && r.fourkites_present;
    if (filter === "extras") return r.service_class === "extra" || r.operation_status === "extra_service";
    if (filter === "cancelled") return r.operation_status === "usps_cancelled";
    if (filter === "review") return r.service_class === "needs_review" || r.operation_status === "needs_review";
    return true;
  }), [rows, contract, search, filter]);

  const cardStyle = (active: boolean): React.CSSProperties => ({ border: active ? "2px solid #17375e" : "1px solid #d7e0ea", background: active ? "#eef4fb" : "white", borderRadius: 12, padding: "14px 16px", textAlign: "left", cursor: "pointer", minWidth: 145 });

  return <section style={{ display: "grid", gap: 18 }}>
    <div style={{ background: "linear-gradient(135deg,#0f2747,#17375e)", color: "white", padding: 24, borderRadius: 14 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, opacity: .8 }}>Operations checks & balances</div>
      <h1 style={{ margin: "6px 0 8px" }}>Load Reconciliation</h1>
      <p style={{ margin: 0, maxWidth: 850, opacity: .9 }}>Match CLEAR and FourKites by load number and service date. Surface missing records, extras, USPS cancellations and anything that needs human review before payment reconciliation.</p>
    </div>

    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {(Object.keys(LABELS) as Filter[]).map(key => <button key={key} type="button" style={cardStyle(filter === key)} onClick={() => setFilter(key)}>
        <div style={{ fontSize: 12, color: "#52677f", fontWeight: 700 }}>{LABELS[key]}</div>
        <div style={{ fontSize: 28, color: "#0f2747", fontWeight: 800, marginTop: 3 }}>{counts[key].toLocaleString()}</div>
      </button>)}
    </div>

    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", background: "white", border: "1px solid #d7e0ea", borderRadius: 12, padding: 14 }}>
      <select value={contract} onChange={e => setContract(e.target.value)} style={{ padding: "9px 12px", border: "1px solid #b8c5d3", borderRadius: 8 }}>
        <option value="all">All contracts</option>{contracts.map(c => <option key={c}>{c}</option>)}
      </select>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search load, contract, trip or code" style={{ padding: "9px 12px", border: "1px solid #b8c5d3", borderRadius: 8, minWidth: 280, flex: 1 }} />
      <button type="button" onClick={() => void load()} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #17375e", background: "#17375e", color: "white", fontWeight: 700 }}>Refresh</button>
    </div>

    {error && <div style={{ padding: 14, borderRadius: 10, background: "#fff1f1", color: "#8d1f1f" }}>{error}</div>}
    {loading ? <div style={{ padding: 24 }}>Loading Load Master…</div> : rows.length === 0 ? <div style={{ padding: 24, background: "white", border: "1px solid #d7e0ea", borderRadius: 12 }}><strong>No Load Master records yet.</strong><div style={{ marginTop: 6, color: "#52677f" }}>Upload a FourKites load-details report or a full CLEAR report. Those existing workflows now feed this page automatically.</div></div> :
    <div style={{ overflowX: "auto", background: "white", border: "1px solid #d7e0ea", borderRadius: 12 }}>
      <div style={{ padding: "13px 16px", borderBottom: "1px solid #e3e9ef", fontWeight: 800 }}>{LABELS[filter]} · {visible.length.toLocaleString()} loads</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ background: "#f4f7fa", textAlign: "left" }}>
        {['Date','Load','Contract','Trip / Code','CLEAR','FourKites','CLEAR Miles','Classification','Status'].map(h => <th key={h} style={{ padding: 10, borderBottom: "1px solid #d7e0ea", whiteSpace: "nowrap" }}>{h}</th>)}
      </tr></thead><tbody>{visible.slice(0, 1000).map(r => <tr key={r.id} style={{ borderBottom: "1px solid #edf1f5" }}>
        <td style={{ padding: 10, whiteSpace: "nowrap" }}>{r.service_date}</td><td style={{ padding: 10, fontWeight: 800 }}>{r.load_number}</td><td style={{ padding: 10 }}>{r.contract_number || '—'}</td><td style={{ padding: 10 }}>{r.trip_number || r.service_code || '—'}</td>
        <td style={{ padding: 10 }}>{r.clear_present ? '✓' : '—'}</td><td style={{ padding: 10 }}>{r.fourkites_present ? '✓' : '—'}</td><td style={{ padding: 10 }}>{r.clear_miles == null ? '—' : Number(r.clear_miles).toFixed(1)}</td>
        <td style={{ padding: 10 }}>{r.service_class.replaceAll('_',' ')}</td><td style={{ padding: 10 }}>{r.operation_status.replaceAll('_',' ')}{r.cancellation_reason ? <div style={{ color: '#65788d', fontSize: 11, marginTop: 2 }}>{r.cancellation_reason}</div> : null}</td>
      </tr>)}</tbody></table>
      {visible.length > 1000 && <div style={{ padding: 12, color: "#52677f" }}>Showing the newest 1,000 matching loads. Narrow by contract or search to inspect older records.</div>}
    </div>}
  </section>;
}
