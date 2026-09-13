"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function validEmail() {
    const normalized = email.trim().toLowerCase();
    if (!normalized.endsWith("@dtexpress.net")) {
      setMessage("Use an approved @dtexpress.net email address.");
      return null;
    }
    return normalized;
  }

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    const normalized = validEmail();
    if (!normalized) return;
    setLoading(true); setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (error) setMessage(error.message);
    else window.location.assign("/history");
    setLoading(false);
  }

  async function sendEmailLink() {
    const normalized = validEmail();
    if (!normalized) return;
    setLoading(true); setMessage("");
    const { error } = await supabase.auth.signInWithOtp({ email: normalized, options: {
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/history`,
      data: normalized === "estafford@dtexpress.net" ? { full_name: "Emily Stafford" } : undefined,
    } });
    setMessage(error ? error.message : "Check your DT Express email for the secure sign-in link.");
    setLoading(false);
  }

  return <main className="page-shell"><section className="empty-state"><div className="empty-icon">DT</div><h1>Employee sign in</h1><p>Only approved DT Express employees can access shared report history.</p><form className="login-form" onSubmit={signInWithPassword}><label htmlFor="email">DT Express email</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@dtexpress.net" required/><label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required/><button className="upload-button" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button><button className="secondary-button login-secondary" type="button" onClick={sendEmailLink} disabled={loading}>Email me a secure link instead</button></form>{message && <p>{message}</p>}</section></main>;
}
