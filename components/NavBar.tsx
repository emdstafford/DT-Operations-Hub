"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const operationsLinks = [
  ["Dashboard", "/"],
  ["Schedule Builder", "/schedule-builder"],
  ["Upload", "/upload"],
  ["History", "/history"],
];

export default function NavBar({ operationsAccess, payrollAccess }: { operationsAccess: boolean; payrollAccess: boolean }) {
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
        <Link href="/" className="brand">
          <Image src="/logo.png" alt="Davenport Transportation" width={68} height={68} priority />
          <div><strong>DT Intelligence Hub</strong><span>Performance intelligence</span></div>
        </Link>
        <div className="header-status"><span className="status-dot" />{employee || "Operations reporting"}</div>
      </div>
      <nav className="main-nav" aria-label="Primary navigation">
        {operationsAccess && operationsLinks.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        {payrollAccess && <Link href="/payroll/holiday-hours">Payroll Tools</Link>}
        {employee && <button className="nav-button" onClick={signOut}>Sign Out</button>}
      </nav>
    </header>
  );
}
