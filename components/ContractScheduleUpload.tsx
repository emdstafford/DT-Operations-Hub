"use client";

import { useMemo, useState } from "react";
import { parseUspsSchedule, type ScheduleAnalysis, type ScheduleTrip } from "@/lib/parseUspsSchedule";
import { supabase } from "@/lib/supabase";

type ExistingTrip = {
  trip_number: string;
  frequency_code: string | null;
  trip_miles: number | null;
  trip_hours: number | null;
  vehicle_type: string | null;
  effective_from: string;
  effective_to: string | null;
};

type ChangeRow = {
  trip: ScheduleTrip;
  status: "new" | "changed" | "unchanged";
};

function sameNumber(a: number | null, b: number | null) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.001;
}

export default function ContractScheduleUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);
  const [existing, setExisting] = useState<ExistingTrip[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function choose(selected?: File) {
    if (!selected) return;
    setFile(selected);
    setAnalysis(null);
    setExisting([]);
    setError("");
    setMessage("");
    setReading(true);
    try {
      const parsed = await parseUspsSchedule(selected);
      setAnalysis(parsed);
      if (parsed.contractNumber) {
        const result = await supabase
          .from("contract_trip_versions")
          .select("trip_number,frequency_code,trip_miles,trip_hours,vehicle_type,effective_from,effective_to")
          .eq("contract_number", parsed.contractNumber)
          .order("effective_from", { ascending: false });
        if (!result.error) setExisting((result.data || []) as ExistingTrip[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "This schedule could not be read.");
    } finally {
      setReading(false);
    }
  }

  const changes = useMemo<ChangeRow[]>(() => {
    if (!analysis) return [];
    return analysis.trips.map((trip) => {
      const prior = existing.find((row) =>
        row.trip_number === trip.tripNumber &&
        row.effective_from === trip.effectiveFrom
      ) || existing.find((row) =>
        row.trip_number === trip.tripNumber &&
        row.effective_from <= (trip.effectiveFrom || "9999-12-31") &&
        (!row.effective_to || row.effective_to >= (trip.effectiveFrom || "0001-01-01"))
      );
      if (!prior) return { trip, status: "new" };
      const unchanged =
        (prior.frequency_code || "") === (trip.frequencyCode || "") &&
        (prior.vehicle_type || "") === (trip.vehicleType || "") &&
        sameNumber(prior.trip_miles == null ? null : Number(prior.trip_miles), trip.tripMiles) &&
        sameNumber(prior.trip_hours == null ? null : Number(prior.trip_hours), trip.tripHours) &&
        prior.effective_from === trip.effectiveFrom &&
        (prior.effective_to || null) === (trip.effectiveTo || null);
      return { trip, status: unchanged ? "unchanged" : "changed" };
    });
  }, [analysis, existing]);

  const counts = useMemo(() => ({
    new: changes.filter((row) => row.status === "new").length,
    changed: changes.filter((row) => row.status === "changed").length,
    unchanged: changes.filter((row) => row.status === "unchanged").length,
  }), [changes]);

  const saveReady = Boolean(
    analysis?.contractNumber &&
    analysis.trips.length &&
    analysis.trips.every((trip) => trip.effectiveFrom && trip.tripMiles != null && trip.tripHours != null)
  );

  async function save() {
    if (!analysis || !file || !saveReady) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await supabase.rpc("save_contract_schedule_import", {
        p_contract: analysis.contractNumber,
        p_document_name: file.name,
        p_trips: analysis.trips,
        p_notes: analysis.changeSummaryFound ? "Trip Change Summary present in source schedule." : null,
      });
      if (result.error) throw result.error;
      const summary = result.data as { saved?: number; changed?: number; unchanged?: number } | null;
      setMessage(`Saved ${summary?.saved ?? analysis.trips.length} reviewed trip version(s) for ${analysis.contractNumber}. ${summary?.unchanged ?? 0} unchanged version(s) were left alone.`);
      const refresh = await supabase
        .from("contract_trip_versions")
        .select("trip_number,frequency_code,trip_miles,trip_hours,vehicle_type,effective_from,effective_to")
        .eq("contract_number", analysis.contractNumber)
        .order("effective_from", { ascending: false });
      if (!refresh.error) setExisting((refresh.data || []) as ExistingTrip[]);
    } catch (e) {
      const text = e instanceof Error ? e.message : String((e as { message?: string })?.message || e);
      setError(text.includes("save_contract_schedule_import")
        ? "Run contract_schedule_import.sql in Supabase once, then click Save Contract Schedule again."
        : text);
    } finally {
      setSaving(false);
    }
  }

  return <div style={{ display: "grid", gap: 16 }}>
    <section style={{ background: "#fff", border: "1px solid #d7e0ea", borderRadius: 14, padding: 20 }}>
      <h2 style={{ margin: 0, color: "#0f2747" }}>Upload contract schedule</h2>
      <p style={{ color: "#607286", lineHeight: 1.5 }}>Upload the official USPS contract schedule or revised schedule PDF. This area is for contract data only — not Schedule Builder.</p>
      <label style={{ display: "block", border: "2px dashed #9fb2c7", borderRadius: 12, padding: 28, textAlign: "center", cursor: "pointer", background: "#f8fafc" }}>
        <strong style={{ color: "#123b61" }}>{file ? file.name : "Choose USPS contract schedule PDF"}</strong>
        <div style={{ marginTop: 5, color: "#718399", fontSize: 13 }}>{reading ? "Reading contract, trips and effective dates…" : "PDF · base contract or revised schedule"}</div>
        <input type="file" accept=".pdf,application/pdf" style={{ display: "none" }} onChange={e => void choose(e.target.files?.[0])} />
      </label>
      {error && <p style={{ color: "#a22626", fontWeight: 700 }}>{error}</p>}
      {message && <p style={{ color: "#17633a", fontWeight: 800 }}>{message}</p>}
    </section>

    {analysis && <section style={{ background: "#fff", border: "1px solid #d7e0ea", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div><p style={{ margin: 0, color: "#607286", fontSize: 12, fontWeight: 800, letterSpacing: ".08em" }}>DETECTED CONTRACT</p><h2 style={{ margin: "3px 0 0", color: "#0f2747" }}>{analysis.contractNumber || "Needs review"}</h2></div>
        <div style={{ textAlign: "right" }}><strong>{analysis.trips.length || analysis.tripIds.length} trips detected</strong><div style={{ color: "#607286", fontSize: 13 }}>{analysis.pageCount} PDF pages</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 18 }}>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Effective dates</strong><div style={{ marginTop: 5, fontSize: 13 }}>{analysis.effectiveDates.join(", ") || "None confidently detected"}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Frequency codes</strong><div style={{ marginTop: 5, fontSize: 13 }}>{analysis.frequencyCodes.length}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Annual miles</strong><div style={{ marginTop: 5, fontSize: 13 }}>{analysis.annualMiles?.toLocaleString() ?? "Needs review"}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>New</strong><div style={{ marginTop: 5, fontSize: 20, fontWeight: 850 }}>{counts.new}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Changed</strong><div style={{ marginTop: 5, fontSize: 20, fontWeight: 850 }}>{counts.changed}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Unchanged</strong><div style={{ marginTop: 5, fontSize: 20, fontWeight: 850 }}>{counts.unchanged}</div></div>
      </div>

      <div style={{ marginTop: 18, overflowX: "auto", border: "1px solid #d7e0ea", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f4f7fa", textAlign: "left" }}>{["Trip","Status","Vehicle","Freq","Freq days","Miles","Hours","Effective","Expires"].map(h => <th key={h} style={{ padding: 9, borderBottom: "1px solid #d7e0ea" }}>{h}</th>)}</tr></thead>
          <tbody>{changes.map(({ trip, status }) => <tr key={`${trip.tripNumber}-${trip.effectiveFrom}`} style={{ borderBottom: "1px solid #edf1f5" }}>
            <td style={{ padding: 9, fontWeight: 800 }}>{trip.tripNumber}</td>
            <td style={{ padding: 9, textTransform: "capitalize" }}>{status}</td>
            <td style={{ padding: 9 }}>{trip.vehicleType || "—"}</td>
            <td style={{ padding: 9 }}>{trip.frequencyCode || "—"}</td>
            <td style={{ padding: 9 }}>{trip.frequencyDays ?? "—"}</td>
            <td style={{ padding: 9 }}>{trip.tripMiles ?? "—"}</td>
            <td style={{ padding: 9 }}>{trip.tripHours ?? "—"}</td>
            <td style={{ padding: 9, whiteSpace: "nowrap" }}>{trip.effectiveFrom || "—"}</td>
            <td style={{ padding: 9, whiteSpace: "nowrap" }}>{trip.effectiveTo || "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>

      {!!analysis.warnings.length && <div style={{ marginTop: 16, padding: 13, background: "#fff8e8", borderRadius: 10 }}>{analysis.warnings.map(w => <div key={w} style={{ fontSize: 13, margin: "3px 0" }}>⚠ {w}</div>)}</div>}

      <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" disabled={!saveReady || saving} onClick={() => void save()} style={{ padding: "11px 17px", border: 0, borderRadius: 8, background: saveReady ? "#17375e" : "#9aa9b8", color: "#fff", fontWeight: 850, cursor: saveReady ? "pointer" : "not-allowed" }}>{saving ? "Saving…" : "Save Contract Schedule"}</button>
        <span style={{ color: "#607286", fontSize: 13 }}>{saveReady ? "This preserves effective-dated trip history; unchanged versions are not duplicated." : "Save is blocked until every detected trip has an effective date, miles, and hours."}</span>
      </div>
    </section>}
  </div>;
}
