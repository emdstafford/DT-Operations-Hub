"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const links = [
  ["Dashboard", "/"],
  ["Upload", "/upload"],
  ["History", "/history"],
  ["Completion", "/completion-totals"],
  ["Supervisors", "/supervisors"],
  ["Contracts", "/contracts"],
  ["Sign In", "/login"],
];

export default function NavBar() {
  const [employee, setEmployee] = useState("");
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmployee(String(data.user?.user_metadata?.full_name || data.user?.email || "")));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setEmployee(String(session?.user.user_metadata?.full_name || session?.user.email || "")));
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
        {links.filter(([label]) => label !== "Sign In" || !employee).map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        {employee && <button className="nav-button" onClick={signOut}>Sign Out</button>}
      </nav>
    </header>
  );
}
