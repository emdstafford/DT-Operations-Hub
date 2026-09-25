"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function NavBar({ operationsRole, payrollAccess, fuelAccess }: { operationsRole: string; payrollAccess: boolean; fuelAccess: boolean }) {
  const pathname = usePathname();
  const operationsAccess = Boolean(operationsRole);
  const canManageReports = operationsRole === "admin" || operationsRole === "uploader";
  const [employee, setEmployee] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    function updateEmployee(email?: string, name?: string) {
      setEmployee(String(name || email || ""));
    }
    void supabase.auth.getUser().then(({ data }) => updateEmployee(data.user?.email, String(data.user?.user_metadata?.full_name || "")));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => void updateEmployee(session?.user.email, String(session?.user.user_metadata?.full_name || "")));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signOut() { await supabase.auth.signOut(); setEmployee(""); }
  return (
    <header className="site-header">
      <div className="brand-row">
        <Link href={operationsAccess ? "/" : fuelAccess ? "/fuel" : "/payroll"} className="brand">
          <Image src="/logo.png" alt="Davenport Transportation" width={68} height={68} priority />
          <div><strong>DT Intelligence Hub</strong><span>Performance intelligence</span></div>
        </Link>
      </div>
      <button type="button" className="mobile-nav-toggle" aria-controls="primary-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "Close" : "Menu"}</button>
      <nav id="primary-navigation" className={`main-nav${menuOpen ? " is-open" : ""}`} aria-label="Primary navigation" onClick={() => setMenuOpen(false)}>
        {operationsAccess && <Link className={pathname === "/" ? "active" : ""} href="/">Dashboard</Link>}
        {operationsAccess && operationsRole !== "dashboard_fuel_viewer" && <Link className={pathname.startsWith("/contracts") ? "active" : ""} href="/contracts">Contracts</Link>}
        {fuelAccess && <Link className={pathname.startsWith("/fuel") ? "active" : ""} href="/fuel">Fuel</Link>}
        {payrollAccess && <Link className={pathname.startsWith("/payroll") ? "active" : ""} href="/payroll">Payroll</Link>}
        {operationsAccess && canManageReports && <Link className={pathname.startsWith("/schedule-builder") ? "active" : ""} href="/schedule-builder">Schedule</Link>}
        {operationsAccess && canManageReports && <Link className={pathname.startsWith("/history") ? "active" : ""} href="/history">History</Link>}
      </nav>
      <div className="sidebar-user">
        <div className="header-status"><span className="status-dot" /><span>{employee || "DT Express employee"}</span></div>
        {employee && <button className="nav-button" onClick={signOut}>Sign Out</button>}
      </div>
    </header>
  );
}
