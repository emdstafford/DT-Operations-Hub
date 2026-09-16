"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function PayrollAccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email?.toLowerCase();
      if (!email) {
        if (active) setState("denied");
        return;
      }
      const { data, error } = await supabase
        .from("payroll_tool_users")
        .select("email")
        .eq("email", email)
        .eq("active", true)
        .maybeSingle();
      if (active) setState(!error && data ? "allowed" : "denied");
    })();
    return () => { active = false; };
  }, []);

  if (state === "checking") {
    return <section className="panel payroll-access-message"><h2>Checking payroll access…</h2></section>;
  }
  if (state === "denied") {
    return <section className="panel payroll-access-message">
      <p className="eyebrow">Restricted payroll tool</p>
      <h2>Payroll access required</h2>
      <p>This page is available only to employees specifically approved for payroll tools.</p>
    </section>;
  }
  return <>{children}</>;
}
