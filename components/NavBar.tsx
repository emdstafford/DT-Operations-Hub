"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const operationsLinks = [
  ["Dashboard", "/"],
  ["Schedule Builder", "/schedule-builder"],
  ["History", "/history"],
];

export default function NavBar({ operationsRole, payrollAccess }: { operationsRole: string; payrollAccess: boolean }) {
  const pathname = usePathname();
  const operationsAccess = Boolean(operationsRole);
  const canManageReports = operationsRole === "admin" || operationsRole === "uploader";
  const [employee, setEmployee] = useState("");
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
        <Link href={operationsAccess ? "/" : "/payroll/holiday-hours"} className="brand">
          <Image src="/logo.png" alt="Davenport Transportation" width={68} height={68} priority />
          <div><strong>DT Intelligence Hub</strong><span>Performance intelligence</span></div>
        </Link>
      </div>
      <nav className="main-nav" aria-label="Primary navigation">
        {operationsAccess && operationsLinks
          .filter(([, href]) => href === "/" || canManageReports)
          .map(([label, href]) => <Link className={pathname === href ? "active" : ""} href={href} key={href}>{label}</Link>)}
        {payrollAccess && <Link className={pathname.startsWith("/payroll/") ? "active" : ""} href="/payroll/holiday-hours">Payroll Tools</Link>}
      </nav>
      <div className="sidebar-user">
        <div className="header-status"><span className="status-dot" /><span>{employee || "DT Express employee"}</span></div>
        {employee && <button className="nav-button" onClick={signOut}>Sign Out</button>}
      </div>
    </header>
  );
}
