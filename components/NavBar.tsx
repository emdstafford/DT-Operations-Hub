"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const noReportsRoles = new Set(["dashboard_fuel_viewer", "dashboard_contracts_fuel_viewer"]);
const privateReviewRecipients = new Set(["estafford@dtexpress.net","ccochran@dtexpress.net"]);

export default function NavBar({ operationsRole, payrollAccess, fuelAccess, techInvoiceAccess }: { operationsRole: string; payrollAccess: boolean; fuelAccess: boolean; techInvoiceAccess: boolean }) {
  const pathname = usePathname();
  const operationsAccess = Boolean(operationsRole);
  const canManageReports = operationsRole === "admin" || operationsRole === "uploader";
  const isNoReportsRole = noReportsRoles.has(operationsRole);
  const isContractsFuelViewer = operationsRole === "dashboard_contracts_fuel_viewer";
  const hasUserManagement = operationsRole === "admin";
  const [employee, setEmployee] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reviewAlerts,setReviewAlerts] = useState(0);
  const [reviewAlertsEnabled,setReviewAlertsEnabled] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    function updateEmployee(email?: string, name?: string) {
      setEmployee(String(name || email || ""));
    }
    void supabase.auth.getUser().then(({ data }) => updateEmployee(data.user?.email, String(data.user?.user_metadata?.full_name || "")));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => void updateEmployee(session?.user.email, String(session?.user.user_metadata?.full_name || "")));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(()=>{
    let active=true;
    let interval:ReturnType<typeof setInterval>|undefined;
    async function refresh(){
      const {data:{user}}=await supabase.auth.getUser();
      const allowed=operationsRole==="admin"&&privateReviewRecipients.has((user?.email||"").toLowerCase());
      if(!active)return;
      setReviewAlertsEnabled(allowed);
      if(!allowed){setReviewAlerts(0);return;}
      const {count,error}=await supabase.from("missed_load_reviews")
        .select("id",{count:"exact",head:true})
        .or("review_status.in.(needs_review,follow_up),ticket_status.eq.needs_ticket");
      if(active&&!error)setReviewAlerts(count||0);
    }
    void refresh();
    interval=setInterval(()=>void refresh(),90000);
    const focus=()=>void refresh();
    window.addEventListener("focus",focus);
    return()=>{active=false;clearInterval(interval);window.removeEventListener("focus",focus)};
  },[operationsRole,pathname]);

  async function signOut() { await supabase.auth.signOut(); setEmployee(""); setReviewAlerts(0); }
  return (
    <header className="site-header">
      <div className="brand-row">
        <Link href={operationsAccess ? "/" : fuelAccess ? "/fuel" : payrollAccess ? "/payroll" : "/tech-invoices"} className="brand">
          <Image src="/logo.png" alt="Davenport Transportation" width={68} height={68} priority />
          <div><strong>DT Intelligence Hub</strong><span>Performance intelligence</span></div>
        </Link>
      </div>
      <button type="button" className="mobile-nav-toggle" aria-controls="primary-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "Close" : "Menu"}</button>
      <nav id="primary-navigation" className={`main-nav${menuOpen ? " is-open" : ""}`} aria-label="Primary navigation" onClick={() => setMenuOpen(false)}>
        {operationsAccess && <Link className={pathname === "/" ? "active" : ""} href="/">Dashboard</Link>}
        {operationsAccess && canManageReports && <Link className={pathname.startsWith("/unassigned-trips") ? "active" : ""} href="/unassigned-trips">Unassigned Trips</Link>}
        {operationsAccess && operationsRole !== "dashboard_fuel_viewer" && <Link className={pathname.startsWith("/contracts") ? "active" : ""} href="/contracts">Contracts</Link>}
        {operationsAccess && ["admin","uploader","viewer"].includes(operationsRole) && <Link className={pathname.startsWith("/missed-load-reviews") ? "active" : ""} href="/missed-load-reviews">Missed Load Reviews{reviewAlertsEnabled&&reviewAlerts>0&&<span className="ops-review-notice" title="Saved explanations or corrections requiring review">{reviewAlerts} to check</span>}</Link>}
        {(operationsAccess || fuelAccess || payrollAccess) && !isNoReportsRole && <Link className={pathname.startsWith("/reports") ? "active" : ""} href="/reports">Reports</Link>}
        {fuelAccess && <Link className={pathname.startsWith("/fuel") ? "active" : ""} href="/fuel">Fuel</Link>}
        {payrollAccess && !isContractsFuelViewer && <Link className={pathname.startsWith("/payroll") ? "active" : ""} href="/payroll">Payroll</Link>}
        {techInvoiceAccess && !isContractsFuelViewer && <Link className={pathname.startsWith("/tech-invoices") ? "active" : ""} href="/tech-invoices">Tech invoices</Link>}
        {operationsAccess && canManageReports && <Link className={pathname.startsWith("/schedule-builder") ? "active" : ""} href="/schedule-builder">Schedule</Link>}
        {operationsAccess && canManageReports && <Link className={pathname.startsWith("/history") ? "active" : ""} href="/history">History</Link>}
        {hasUserManagement && <Link className={pathname.startsWith("/admin/users") ? "active" : ""} href="/admin/users">User access</Link>}
      </nav>
      <div className="sidebar-user">
        <div className="header-status"><span className="status-dot" /><span>{employee || "DT Express employee"}</span></div>
        {employee && <Link className="nav-button account-password-link" href="/account/password">Change password</Link>}
        {employee && <button className="nav-button" onClick={signOut}>Sign Out</button>}
      </div>
    </header>
  );
}
