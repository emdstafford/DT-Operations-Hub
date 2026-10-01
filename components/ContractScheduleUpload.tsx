"use client";

import { useState } from "react";
import { parseUspsSchedule, type ScheduleAnalysis } from "@/lib/parseUspsSchedule";

export default function ContractScheduleUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  async function choose(selected?: File) {
    if (!selected) return;
    setFile(selected);
    setAnalysis(null);
    setError("");
    setReading(true);
    try {
      setAnalysis(await parseUspsSchedule(selected));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This schedule could not be read.");
    } finally {
      setReading(false);
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
    </section>

    {analysis && <section style={{ background: "#fff", border: "1px solid #d7e0ea", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div><p style={{ margin: 0, color: "#607286", fontSize: 12, fontWeight: 800, letterSpacing: ".08em" }}>DETECTED CONTRACT</p><h2 style={{ margin: "3px 0 0", color: "#0f2747" }}>{analysis.contractNumber || "Needs review"}</h2></div>
        <div style={{ textAlign: "right" }}><strong>{analysis.tripIds.length} trips detected</strong><div style={{ color: "#607286", fontSize: 13 }}>{analysis.pageCount} PDF pages</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginTop: 18 }}>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Effective dates</strong><div style={{ marginTop: 5, fontSize: 13 }}>{analysis.effectiveDates.join(", ") || "None confidently detected"}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Frequency codes</strong><div style={{ marginTop: 5, fontSize: 13 }}>{analysis.frequencyCodes.length}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Annual miles</strong><div style={{ marginTop: 5, fontSize: 13 }}>{analysis.annualMiles?.toLocaleString() ?? "Needs review"}</div></div>
        <div style={{ padding: 13, background: "#f5f8fb", borderRadius: 10 }}><strong>Trip change summary</strong><div style={{ marginTop: 5, fontSize: 13 }}>{analysis.changeSummaryFound ? "Found" : "Not found"}</div></div>
      </div>

      <div style={{ marginTop: 18 }}><strong style={{ color: "#0f2747" }}>Trips found</strong><div style={{ marginTop: 7, lineHeight: 1.8, color: "#40566d" }}>{analysis.tripIds.join(", ") || "No trips confidently detected"}</div></div>
      {!!analysis.warnings.length && <div style={{ marginTop: 16, padding: 13, background: "#fff8e8", borderRadius: 10 }}>{analysis.warnings.map(w => <div key={w} style={{ fontSize: 13, margin: "3px 0" }}>⚠ {w}</div>)}</div>}

      <div style={{ marginTop: 18, padding: 14, border: "1px solid #cbd7e4", borderRadius: 10, color: "#52677f", fontSize: 13, lineHeight: 1.5 }}><strong>Review before saving.</strong> The next step will compare this schedule with the saved effective-dated contract history and show Added / Changed / Removed trips before approval. Nothing should overwrite an older contract version.</div>
    </section>}
  </div>;
}
