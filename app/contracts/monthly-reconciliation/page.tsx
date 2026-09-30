import Link from "next/link";
import MonthlyClearReconciliation from "@/components/MonthlyClearReconciliation";

const steps = [
  { n: "1", title: "Period", detail: "Choose supervisor and month" },
  { n: "2", title: "EIA & Approval", detail: "Review rate change with Gary" },
  { n: "3", title: "CLEAR", detail: "Upload the raw monthly export" },
  { n: "4", title: "Reconcile", detail: "Compare expected vs actual" },
  { n: "5", title: "Final Report", detail: "Print, email, and save history" },
];

export default function MonthlyReconciliationPage() {
  return (
    <main className="page-shell">
      <header className="page-intro" style={{ alignItems: "flex-start" }}>
        <div style={{ maxWidth: 760 }}>
          <p className="eyebrow">Contract financials</p>
          <h1 style={{ marginBottom: 8 }}>Monthly Contract Reconciliation</h1>
          <p style={{ maxWidth: 700 }}>
            Build the expected month from contract rules, compare it with CLEAR actuals,
            approve the monthly mileage rate, and create one final supervisor report.
          </p>
        </div>
        <Link
          href="/contracts"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#fff",
            color: "#0f2747",
            textDecoration: "none",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          ← Contracts
        </Link>
      </header>

      <section
        className="card"
        style={{
          marginBottom: 18,
          padding: 18,
          background: "linear-gradient(135deg, #0f2747 0%, #173a67 100%)",
          color: "#fff",
          border: "none",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
          {steps.map((step, index) => (
            <div
              key={step.n}
              style={{
                padding: 12,
                borderRadius: 10,
                background: index === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.08)",
                border: "1px solid rgba(255,255,255,.16)",
              }}
            >
              <div style={{ fontSize: 12, opacity: .78, marginBottom: 4 }}>STEP {step.n}</div>
              <div style={{ fontWeight: 800, marginBottom: 3 }}>{step.title}</div>
              <div style={{ fontSize: 12, lineHeight: 1.35, opacity: .84 }}>{step.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <p className="eyebrow">Step 1</p>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Reporting period</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              The supervisor assignment controls which contract trips are included. Everything else in CLEAR is ignored.
            </p>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: 999,
              background: "#eef4fb",
              color: "#0f2747",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            CURRENT STEP
          </span>
        </div>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <label>
            Supervisor
            <select defaultValue="Tonya Capps-Owen">
              <option>Tonya Capps-Owen</option>
            </select>
          </label>
          <label>
            Reporting month
            <input type="month" defaultValue="2026-08" />
          </label>
        </div>
      </section>

      <MonthlyClearReconciliation />

      <section className="card" style={{ marginTop: 18 }}>
        <p className="eyebrow">Coming next</p>
        <h2 style={{ marginTop: 0 }}>Complete monthly workflow</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
          {[
            ["EIA", "Pull the official monthly diesel value automatically and show the proposed rate change."],
            ["Gary approval", "Print the rate sheet, record approval, and lock the approved monthly rate."],
            ["Reconciliation", "Apply calendar frequency, SVC mileage changes, mileage caps, and exception flags."],
            ["History", "Save the final month and compare mileage, rates, totals, and exceptions over time."],
          ].map(([title, text]) => (
            <div key={title} style={{ padding: 14, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <strong style={{ color: "#0f2747" }}>{title}</strong>
              <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>{text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
