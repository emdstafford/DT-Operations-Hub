"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

export default function PasswordSettingsPage() {
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => { if (active) setEmail(data.user?.email || ""); });
    return () => { active = false; };
  }, []);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setError("");
    if (password.length < 12) { setError("Use at least 12 characters for your new password."); return; }
    if (password !== confirm) { setError("The new passwords do not match."); return; }
    setSaving(true);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) { setError("Your sign-in link expired. Request a new link on the sign-in page."); setSaving(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      ...(current ? { current_password: current } : {}),
    });
    if (updateError) setError(updateError.message);
    else { setCurrent(""); setPassword(""); setConfirm(""); setMessage("Your password was updated. You can use it the next time you sign in."); }
    setSaving(false);
  }

  return <main className="page-shell"><header className="page-intro"><div><p className="eyebrow">Account settings</p><h1>Change password</h1><p>Set a private password for your DT Intelligence Hub account.</p></div></header>
    <section className="panel password-settings-panel">
      <p>Signed in as <strong>{email || "DT Express employee"}</strong></p>
      <form className="password-settings-form" onSubmit={(event) => void changePassword(event)}>
        <label>Current password <span>(optional if you signed in by email link)</span><input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
        <label>New password <span>(at least 12 characters)</span><input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        <button className="primary-link" type="submit" disabled={saving}>{saving ? "Updating…" : "Update password"}</button>
      </form>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {message && <p className="alert fuel-success" role="status">{message}</p>}
    </section>
  </main>;
}
