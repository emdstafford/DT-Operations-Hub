import Link from "next/link";

const sections = [
  {
    title: "Operations",
    description: "Performance, assignments, exceptions, and reconciliation.",
    reports: [
      { name: "USPS Completion Report", description: "Supervisor and contract completion performance for the selected reporting period.", href: "/" },
      { name: "Driver / Contract / Supervisor", description: "See driver assignments by contract and supervisor. Available to all signed-in Hub users.", href: "/fuel" },
      { name: "Load Reconciliation", description: "Compare CLEAR and FourKites, including extras, cancellations, and unmatched loads.", href: "/contracts/load-reconciliation" },
      { name: "Completion Totals", description: "Review completion totals across the operation.", href: "/completion-totals" },
      { name: "Geofence / Missed Stops", description: "Review missed-stop and location-level exceptions.", href: "/geofence" },
    ],
  },
  {
    title: "Contract Financials",
    description: "Contract revenue, CLEAR reconciliation, rates, and monthly review.",
    reports: [
      { name: "Monthly Reconciliation", description: "CLEAR actuals, monthly rates, approvals, and supervisor reconciliation reports.", href: "/contracts/monthly-reconciliation" },
      { name: "Contracts", description: "Open contract detail and contract-at-a-glance information.", href: "/contracts" },
    ],
  },
  {
    title: "Fuel",
    description: "Driver and contract fuel reporting and comparisons.",
    reports: [
      { name: "Fuel Reports", description: "Driver Fuel Report, contract fuel detail, monthly totals, and comparison tools.", href: "/fuel" },
    ],
  },
  {
    title: "Payroll",
    description: "Payroll reports remain visible only to users with payroll access.",
    reports: [
      { name: "Payroll Reports", description: "Timecard comparisons, contract payroll hours, and payroll reporting.", href: "/payroll" },
    ],
  },
];

export default function ReportsPage() {
  return <main className="page-shell">
    <header className="page-intro">
      <div><p className="eyebrow">DT Intelligence Hub</p><h1>Reports Center</h1><p>One place to find reports you need to review, compare, print, or export.</p></div>
    </header>

    <div style={{ display: "grid", gap: 22 }}>
      {sections.map(section => <section key={section.title} style={{ background: "#fff", border: "1px solid #d7e0ea", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", background: "#f4f7fa", borderBottom: "1px solid #d7e0ea" }}>
          <h2 style={{ margin: 0, color: "#0f2747", fontSize: 20 }}>{section.title}</h2>
          <p style={{ margin: "4px 0 0", color: "#607286", fontSize: 13 }}>{section.description}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 12, padding: 14 }}>
          {section.reports.map(report => <Link key={report.name} href={report.href} style={{ display: "block", textDecoration: "none", color: "inherit", padding: 16, border: "1px solid #d7e0ea", borderRadius: 11, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><strong style={{ color: "#123b61", fontSize: 16 }}>{report.name}</strong><span style={{ color: "#123b61", fontSize: 20 }}>→</span></div>
            <div style={{ color: "#607286", fontSize: 13, lineHeight: 1.45, marginTop: 6 }}>{report.description}</div>
          </Link>)}
        </div>
      </section>)}
    </div>
  </main>;
}
