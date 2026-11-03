"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type OperationsRole = "" | "admin" | "uploader" | "viewer" | "dashboard_fuel_viewer" | "dashboard_contracts_fuel_viewer";
type UserAccess = {
  email: string;
  operations_role: string | null;
  operations_active: boolean;
  contract_financial_active: boolean;
  fuel_active: boolean;
  fuel_can_upload: boolean;
  payroll_active: boolean;
  tech_invoice_active: boolean;
};
type AccessDraft = {
  email: string;
  operationsRole: OperationsRole;
  contractFinancialActive: boolean;
  fuelActive: boolean;
  fuelCanUpload: boolean;
  payrollActive: boolean;
  techInvoiceActive: boolean;
};
const blankDraft: AccessDraft = {
  email: "",
  operationsRole: "",
  contractFinancialActive: false,
  fuelActive: false,
  fuelCanUpload: false,
  payrollActive: false,
  techInvoiceActive: false,
};
const roleOptions: { value: OperationsRole; label: string }[] = [
  { value: "", label: "No Dashboard or Contracts access" },
  { value: "dashboard_contracts_fuel_viewer", label: "Dashboard + Contracts (view only)" },
  { value: "dashboard_fuel_viewer", label: "Dashboard + Fuel (view only)" },
  { value: "viewer", label: "Operations viewer (includes Reports)" },
  { value: "uploader", label: "Operations uploader" },
  { value: "admin", label: "Administrator" },
];

function roleLabel(role: string | null, active: boolean) {
  if (!active || !role) return "No access";
  return roleOptions.find((option) => option.value === role)?.label || role;
}
function enabled(value: boolean) { return value ? "Yes" : "No"; }

export default function UserManagement() {
  const [users, setUsers] = useState<UserAccess[]>([]);
  const [draft, setDraft] = useState<AccessDraft>(blankDraft);
  const [currentEmail, setCurrentEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadUsers() {
    setLoading(true);
    setError("");
    const [{ data: userData }, { data, error: accessError }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc("list_hub_user_access"),
    ]);
    setCurrentEmail(String(userData.user?.email || "").toLowerCase());
    if (accessError) setError(accessError.message);
    else setUsers((data || []) as UserAccess[]);
    setLoading(false);
  }

  useEffect(() => { void loadUsers(); }, []);

  function editUser(user: UserAccess) {
    setNotice("");
    setError("");
    setDraft({
      email: user.email,
      operationsRole: user.operations_active ? (user.operations_role as OperationsRole) || "" : "",
      contractFinancialActive: user.contract_financial_active,
      fuelActive: user.fuel_active,
      fuelCanUpload: user.fuel_can_upload,
      payrollActive: user.payroll_active,
      techInvoiceActive: user.tech_invoice_active,
    });
    document.getElementById("user-access-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startNewUser() {
    setDraft(blankDraft);
    setNotice("");
    setError("");
    document.getElementById("user-access-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    const email = draft.email.trim().toLowerCase();
    if (!/^[^\s@]+@dtexpress\.net$/.test(email)) {
      setError("Enter the employee’s @dtexpress.net address.");
      return;
    }
    if (draft.fuelCanUpload && !draft.fuelActive) {
      setError("Turn on Fuel reports before enabling fuel uploads.");
      return;
    }
    if (email === currentEmail) {
      setError("For safety, you can’t change your own access from this screen.");
      return;
    }
    const summary = [
      draft.operationsRole ? roleOptions.find((option) => option.value === draft.operationsRole)?.label : "No Dashboard or Contracts access",
      `Contract schedules/rates: ${enabled(draft.contractFinancialActive)}`,
      `Fuel reports: ${draft.fuelActive ? draft.fuelCanUpload ? "access with upload" : "read only" : "no access"}`,
      `Payroll: ${enabled(draft.payrollActive)}`,
      `Tech Invoices: ${enabled(draft.techInvoiceActive)}`,
    ].join("\n");
    if (!window.confirm(`Save these DT Hub permissions for ${email}?\n\n${summary}`)) return;

    setSaving(true);
    const { error: saveError } = await supabase.rpc("manage_hub_user_access", {
      p_email: email,
      p_operations_role: draft.operationsRole || null,
      p_contract_financial_active: draft.contractFinancialActive,
      p_fuel_active: draft.fuelActive,
      p_fuel_can_upload: draft.fuelCanUpload,
      p_payroll_active: draft.payrollActive,
      p_tech_invoice_active: draft.techInvoiceActive,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setNotice(`Access saved for ${email}. They can use “Email me a secure link” on the sign-in page.`);
    setDraft(blankDraft);
    await loadUsers();
  }

  const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, font: "inherit" };
  const labelStyle = { display: "block", fontWeight: 700, marginBottom: 6 };
  const cardStyle = { border: "1px solid #dbe3ec", borderRadius: 12, padding: 18, background: "#fff" };
  const checkboxRow = { display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0" };

  return <main className="page-shell">
    <header className="page-intro">
      <div><p className="eyebrow">Administrator tools</p><h1>User access</h1><p>Control which parts of the DT Intelligence Hub each employee can use.</p></div>
      <button type="button" className="hub-secondary-link" onClick={startNewUser}>Add user</button>
    </header>

    <section id="user-access-form" className="panel" style={{ ...cardStyle, marginBottom: 22, scrollMarginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>{draft.email ? "Edit user access" : "Add or update a user"}</h2>
      <p style={{ color: "#475569", marginTop: -4 }}>Only @dtexpress.net email addresses are allowed. Changes take effect after the user signs in again.</p>
      <form onSubmit={saveAccess}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
          <div>
            <label htmlFor="hub-user-email" style={labelStyle}>DT Express email</label>
            <input id="hub-user-email" type="email" required autoComplete="off" placeholder="name@dtexpress.net" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="hub-user-operations" style={labelStyle}>Dashboard and Contracts</label>
            <select id="hub-user-operations" value={draft.operationsRole} onChange={(event) => setDraft({ ...draft, operationsRole: event.target.value as OperationsRole })} style={inputStyle}>
              {roleOptions.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 16 }}>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Contracts</h3>
            <label style={checkboxRow}><input type="checkbox" checked={draft.contractFinancialActive} onChange={(event) => setDraft({ ...draft, contractFinancialActive: event.target.checked })} /><span><strong>Contract schedules and rates</strong><br /><small>Access detailed trip schedules and contract rate snapshots.</small></span></label>
          </div>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Fuel</h3>
            <label style={checkboxRow}><input type="checkbox" checked={draft.fuelActive} onChange={(event) => setDraft({ ...draft, fuelActive: event.target.checked, fuelCanUpload: event.target.checked ? draft.fuelCanUpload : false })} /><span><strong>Fuel reports</strong><br /><small>View fuel records and contract totals.</small></span></label>
            <label style={{ ...checkboxRow, opacity: draft.fuelActive ? 1 : 0.55 }}><input type="checkbox" disabled={!draft.fuelActive} checked={draft.fuelCanUpload} onChange={(event) => setDraft({ ...draft, fuelCanUpload: event.target.checked })} /><span><strong>Upload fuel files</strong><br /><small>Allows importing or changing fuel data.</small></span></label>
          </div>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Other tools</h3>
            <label style={checkboxRow}><input type="checkbox" checked={draft.payrollActive} onChange={(event) => setDraft({ ...draft, payrollActive: event.target.checked })} /><span><strong>Payroll</strong><br /><small>Access payroll tools and reports.</small></span></label>
            <label style={checkboxRow}><input type="checkbox" checked={draft.techInvoiceActive} onChange={(event) => setDraft({ ...draft, techInvoiceActive: event.target.checked })} /><span><strong>Tech Invoices</strong><br /><small>Access the technology invoice tracker.</small></span></label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <button className="primary-link" type="submit" disabled={saving}>{saving ? "Saving…" : "Save access"}</button>
          <button className="hub-secondary-link" type="button" onClick={startNewUser} disabled={saving}>Clear form</button>
        </div>
      </form>
      {error && <p role="alert" style={{ color: "#991b1b", marginBottom: 0 }}>{error}</p>}
      {notice && <p role="status" style={{ color: "#166534", marginBottom: 0 }}>{notice}</p>}
    </section>

    <section className="panel" style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div><p className="eyebrow">Current access</p><h2 style={{ marginTop: 0 }}>DT Hub users</h2></div>
        <button type="button" className="hub-secondary-link" onClick={() => void loadUsers()} disabled={loading}>Refresh</button>
      </div>
      {loading ? <p>Loading users…</p> : error && users.length === 0 ? <p role="alert" style={{ color: "#991b1b" }}>Could not load access records. Apply the User Management setup SQL in Supabase, then refresh. Details: {error}</p> : users.length === 0 ? <p>No access records found.</p> : <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>{["Employee", "Dashboard / Contracts", "Contract data", "Fuel", "Payroll", "Tech Invoices", "Edit"].map((heading) => <th key={heading} scope="col" style={{ textAlign: "left", padding: "10px 8px", borderBottom: "2px solid #cbd5e1" }}>{heading}</th>)}</tr></thead>
          <tbody>{users.map((user) => <tr key={user.email}>
            <th scope="row" style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{user.email}</th>
            <td style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>{roleLabel(user.operations_role, user.operations_active)}</td>
            <td style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>{user.contract_financial_active ? "Schedules + rates" : "Standard"}</td>
            <td style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>{user.fuel_active ? user.fuel_can_upload ? "Upload + view" : "Read only" : "No access"}</td>
            <td style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>{user.payroll_active ? "Yes" : "No"}</td>
            <td style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>{user.tech_invoice_active ? "Yes" : "No"}</td>
            <td style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>
              <button className="hub-secondary-link" type="button" disabled={user.email.toLowerCase() === currentEmail} onClick={() => editUser(user)}>{user.email.toLowerCase() === currentEmail ? "Your account" : "Edit"}</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </main>;
}
