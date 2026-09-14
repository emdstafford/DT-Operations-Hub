"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

const logoUrl = "https://cdn.prod.website-files.com/6493ca96ecc7e42995686bc5/68fbcce63d1ad0ff30d74399_Draft%20LogoDT.png";
const videoMp4 = "https://cdn.prod.website-files.com/6493ca96ecc7e42995686bc5%2F6945c542165dd1951137e3d9_HomePageV2_mp4.mp4";
const videoWebm = "https://cdn.prod.website-files.com/6493ca96ecc7e42995686bc5%2F6945c542165dd1951137e3d9_HomePageV2_webm.webm";

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
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (error) setMessage(error.message);
    else window.location.assign("/");
    setLoading(false);
  }

  async function sendEmailLink() {
    const normalized = validEmail();
    if (!normalized) return;
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({ email: normalized, options: {
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
      data: normalized === "estafford@dtexpress.net" ? { full_name: "Emily Stafford" } : undefined,
    } });
    setMessage(error ? error.message : "Check your DT Express email for the secure sign-in link.");
    setLoading(false);
  }

  return (
    <main className="login-screen">
      <video className="login-video" autoPlay muted loop playsInline aria-hidden="true">
        <source src={videoWebm} type="video/webm" />
        <source src={videoMp4} type="video/mp4" />
      </video>
      <div className="login-overlay" />
      <section className="login-card">
        <img className="login-logo" src={logoUrl} alt="Davenport Transportation" />
        <p className="login-eyebrow">Davenport Transportation</p>
        <h1>DT Intelligence Hub</h1>
        <p className="login-intro">Secure USPS performance reporting for approved DT Express employees.</p>
        <form className="login-form" onSubmit={signInWithPassword}>
          <label htmlFor="email">DT Express email</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@dtexpress.net" autoComplete="email" required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          <button className="login-primary" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
          <button className="login-link-button" type="button" onClick={sendEmailLink} disabled={loading}>Email me a secure link instead</button>
        </form>
        {message && <p className="login-message" role="status">{message}</p>}
        <p className="login-footnote">Only approved DT Express accounts can enter.</p>
      </section>
    </main>
  );
}
