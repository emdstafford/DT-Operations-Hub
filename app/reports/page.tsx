"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Report = { name: string; description: string; href: string };
type Section = { title: string; description: string; reports: Report[]; requires?: "fuel" | "payroll" | "operations" };

const sections: Section[] = [
  {
    title: "Operations",
    description: "Performance, assignments, exceptions, and reconciliation.",
    requires: "operations",
    reports: [
      { name: "USPS Completion Report", description: "Supervisor and contract completion performance for the selected reporting period.", href: "/" },
      { name: "Driver / Contract / Supervisor", description: "See driver assignments by contract and supervisor.", href: "/fuel" },
      { name: "Load Reconciliation", description: "Compare CLEAR and FourKites, including extras, cancellations, and unmatched loads.", href: "/contracts/load-reconciliation" },
      { name: "Completion Totals", description: "Review completion totals across the operation.", href: "/completion-totals" },
      { name: "Geofence / Missed Stops", description: "Review missed-stop and location-level exceptions.", href: "/geofence" },
    ],
  },
  {
    title: "Contract Financials",
    description: "Contract revenue, CLEAR reconciliation, rates, and monthly review.",
    requires: "operations",
    reports: [
      { name: "Monthly Reconciliation", description: "CLEAR actuals, monthly rates, approvals, and supervisor reconciliation reports.", href: "/contracts/monthly-reconciliation" },
      { name: "Contracts", description: "Open contract detail and contract-at-a-glance information.", href: "/contracts" },
    ],
  },
  {
    title: "Fuel",
    description: "Driver and contract fuel reporting and comparisons.",
    requires: "fuel",
    reports: [
      { name: "Company Fuel Report", description: "Monthly company fuel activity with compare, CSV, email, and print options.", href: "/fuel" },
      { name: "Driver Fuel Report", description: "Driver transactions, diesel and gas gallons/cost, misc, and totals.", href: "/fuel" },
      { name: "Fuel Month Comparison", description: "Compare fuel totals between selected months by employee and contract.", href: "/fuel" },
    ],
  },
  {
    title: "Payroll",
    description: "The same payroll reports remain available inside Payroll and here in Reports Center.",
    requires: "payroll",
    reports: [
      { name: "Payroll Reports", description: "Timecard comparisons, contract payroll hours, and payroll reporting.", href: "/payroll" },
      { name: "Timecard Comparison", description: "Compare one payroll period with another using the payroll reporting tools.", href: "/payroll" },
      { name: "Contract Payroll Hours", description: "Review daily and period payroll hours by contract.", href: "/payroll" },
    ],
  },
];

export default function ReportsPage() {
  const [access, setAccess] = useState({ operations: false, fuel: false, payroll: false });
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email?.toLowerCase() || "";
      if (!email) { if (active) setChecking(false); return; }
      const [operationsResult, fuelResult, payrollResult] = await Promise.all([
        supabase.from("approved_users").select("email").eq("email", email).eq("active", true).maybeSingle(),
        supabase.from("fuel_tool_users").select("email").eq("email", email).eq("active", true).maybeSingle(),
        supabase.from("payroll_tool_users").select("email").eq("email", email).eq("active", true).maybeSingle(),
      ]);
      if (active) {
        setAccess({ operations: Boolean(operationsResult.data), fuel: Boolean(fuelResult.data), payroll: Boolean(payrollResult.data) });
        setChecking(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const visibleSections = sections.filter(section => !section.requires || access[section.requires]);

  return <main className="page-shell">
    <header className="page-intro">
      <div><p className="eyebrow">DT Intelligence Hub</p><h1>Reports Center</h1><p>One place to find reports you need to review, compare, print, or export.</p></div>
    </header>

    {checking ? <div style={{ padding: 18 }}>Loading reports…</div> : <div style={{ display: "grid", gap: 22 }}>
      {visibleSections.map(section => <section key={section.title} style={{ background: "#fff", border: "1px solid #d7e0ea", borderRadius: 14, overflow: "hidden" }}>
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
    </div>}
  </main>;
}
