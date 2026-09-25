"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Completing secure sign in…");

  useEffect(() => { void (async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) { setMessage(`Sign in could not be completed: ${error.message}`); return; }
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMessage("No sign-in session was received. Please request a new email link."); return; }
    const next = params.get("next") || "/";
    const { data: access } = await supabase.from("approved_users").select("role").eq("email", user.email?.toLowerCase() ?? "").eq("active", true).maybeSingle();
    router.replace(next === "/" && access?.role === "dashboard_fuel_viewer" ? "/fuel" : next);
    router.refresh();
  })(); }, [router]);

  return <main className="page-shell"><section className="empty-state"><div className="empty-icon">DT</div><h1>Employee sign in</h1><p>{message}</p></section></main>;
}
