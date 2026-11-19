"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Report = { name: string; description: string; href: string };
type Section = { title: string; description: string; reports: Report[]; requires?: "fuel" | "payroll" | "operations" };

const sections: Section[] = [
  { title: "Operations", description: "Performance, assignments, exceptions, and reconciliation.", requires: "operations", reports: [
    { name: "USPS Completion Report", description: "Choose dates, supervisors and contracts, then print.", href: "/reports/usps-completion" },
    { name: "Driver / Contract / Supervisor", description: "Choose effective date, supervisors, contracts or drivers, then print.", href: "/reports/driver-contract-supervisor" },
    { name: "Load Reconciliation", description: "Choose dates, contracts and reconciliation status, then print.", href: "/reports/load-reconciliation" },
    { name: "Completion Totals", description: "Choose dates, supervisors and contracts, then print.", href: "/reports/completion-totals" },
    { name: "Geofence / Missed Stops", description: "Choose dates, supervisors and contracts, then print.", href: "/reports/geofence" },
  ]},
  { title: "Contract Financials", description: "Contract revenue, CLEAR reconciliation, rates, and monthly review.", requires: "operations", reports: [
    { name: "Monthly Reconciliation", description: "Choose month and contracts, then print.", href: "/reports/monthly-reconciliation" },
    { name: "Contract Report", description: "Choose month and contract, then print the contract-at-a-glance report.", href: "/reports/contract-summary" },
  ]},
  { title: "Fuel", description: "Driver and contract fuel reporting and comparisons.", requires: "fuel", reports: [
    { name: "Company Fuel Report", description: "Choose month and contracts, then print.", href: "/reports/company-fuel" },
    { name: "Driver Fuel Report", description: "Choose month, driver and contract, then print.", href: "/reports/driver-fuel" },
    { name: "Fuel Month Comparison", description: "Choose two months plus driver/contract filters, then print.", href: "/reports/fuel-comparison" },
  ]},
  { title: "Payroll", description: "Payroll reports are available here and remain available inside Payroll.", requires: "payroll", reports: [
    { name: "Payroll Report", description: "Choose period, contract and driver, then print.", href: "/reports/payroll" },
    { name: "Timecard Comparison", description: "Choose two pay periods plus contract/driver filters, then print.", href: "/reports/timecard-comparison" },
    { name: "Contract Payroll Hours", description: "Choose dates and contracts, then print.", href: "/reports/contract-payroll-hours" },
  ]},
];

export default function ReportsPage() {
  const [access, setAccess] = useState({ operations: false, fuel: false, payroll: false });
  const [checking, setChecking] = useState(true);
  useEffect(() => { let active = true; void (async () => {
    const { data: { user } } = await supabase.auth.getUser(); const email = user?.email?.toLowerCase() || "";
    if (!email) { if (active) setChecking(false); return; }
    const [o,f,p] = await Promise.all([
      supabase.from("approved_users").select("email").eq("email",email).eq("active",true).maybeSingle(),
      supabase.from("fuel_tool_users").select("email").eq("email",email).eq("active",true).maybeSingle(),
      supabase.from("payroll_tool_users").select("email").eq("email",email).eq("active",true).maybeSingle(),
    ]);
    if (active) { setAccess({operations:Boolean(o.data),fuel:Boolean(f.data),payroll:Boolean(p.data)}); setChecking(false); }
  })(); return () => { active=false; }; }, []);
  const visible = sections.filter(s => !s.requires || access[s.requires]);
  return <main className="page-shell operations-polish">
    <header className="page-intro"><div><p className="eyebrow">DT Intelligence Hub</p><h1>Reports</h1><p>Select a report to view or print.</p></div></header>
    {checking ? <div className="panel" style={{padding:18}}>Loading reports…</div> :
      <div className="ops-catalog">{visible.map(section =>
        <section key={section.title} className="panel ops-catalog-section">
          <div className="ops-catalog-head"><h2>{section.title}</h2><p>{section.description}</p></div>
          <div className="ops-catalog-links">{section.reports.map(report =>
            <Link key={report.name} href={report.href} className="ops-catalog-link">
              <div><strong>{report.name}</strong><p>{report.description.replace(/^Choose (dates|effective date|month|two months|period),? ?/i,"Filters: ").replace(/,? then print\.?$/i,"").replace(/,? and print\.?$/i,"")}</p></div>
              <span className="ops-catalog-arrow" aria-hidden="true">→</span>
            </Link>
          )}</div>
        </section>
      )}</div>}
  </main>;
}
