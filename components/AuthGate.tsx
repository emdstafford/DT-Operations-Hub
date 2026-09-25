"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import NavBar from "@/components/NavBar";
import { AccessRole } from "@/components/AccessRole";
import { supabase } from "@/lib/supabase";

const publicPaths = ["/login", "/auth/callback"];
const reportManagementPaths = ["/upload", "/history", "/schedule-builder", "/historical-upload", "/admin"];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [operationsRole, setOperationsRole] = useState("");
  const [payrollAccess, setPayrollAccess] = useState(false);
  const [fuelAccess, setFuelAccess] = useState(false);
  const isPublic = publicPaths.some((path) => pathname.startsWith(path));

  useEffect(() => {
    let active = true;
    async function applySession(nextSession: Session | null) {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setOperationsRole("");
        setPayrollAccess(false);
        setFuelAccess(false);
        setChecking(false);
        if (!isPublic) router.replace("/login");
        return;
      }

      const email = nextSession.user.email?.toLowerCase() ?? "";
      const [operationsResult, payrollResult, fuelResult] = await Promise.all([
        supabase.from("approved_users").select("email, role").eq("email", email).eq("active", true).maybeSingle(),
        supabase.from("payroll_tool_users").select("email").eq("email", email).eq("active", true).maybeSingle(),
        supabase.from("fuel_tool_users").select("email").eq("email", email).eq("active", true).maybeSingle(),
      ]);
      if (!active) return;
      const canUseOperations = Boolean(operationsResult.data);
      const canUsePayroll = Boolean(payrollResult.data);
      const canUseFuel = Boolean(fuelResult.data);
      const role = String(operationsResult.data?.role || "");
      const canManageReports = role === "admin" || role === "uploader";
      const isReportManagementPath = reportManagementPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
      setOperationsRole(role);
      setPayrollAccess(canUsePayroll);
      setFuelAccess(canUseFuel);
      setChecking(false);

      if (!canUseOperations && !canUsePayroll && !canUseFuel) {
        await supabase.auth.signOut();
        if (active) router.replace("/login?error=not-approved");
      } else if (pathname === "/login") {
        router.replace(role === "dashboard_fuel_viewer" ? "/fuel" : canUseOperations ? "/" : canUseFuel ? "/fuel" : "/payroll");
      } else if (pathname.startsWith("/payroll") && !canUsePayroll) {
        router.replace(canUseOperations ? "/" : canUseFuel ? "/fuel" : "/login");
      } else if (pathname.startsWith("/fuel") && !canUseFuel) {
        router.replace(canUseOperations ? "/" : "/payroll");
      } else if (!pathname.startsWith("/payroll") && !pathname.startsWith("/fuel") && !canUseOperations) {
        router.replace(canUseFuel ? "/fuel" : "/payroll");
      } else if (role === "dashboard_fuel_viewer" && pathname !== "/" && !pathname.startsWith("/fuel")) {
        router.replace("/");
      } else if (isReportManagementPath && !canManageReports) {
        router.replace("/");
      }
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => void applySession(nextSession), 0);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [isPublic, pathname, router]);

  if (checking) return <main className="auth-loading"><img src="https://cdn.prod.website-files.com/6493ca96ecc7e42995686bc5/68fbcce63d1ad0ff30d74399_Draft%20LogoDT.png" alt="Davenport Transportation" /><span>Loading DT Intelligence Hub…</span></main>;
  if (isPublic) return <>{children}</>;
  if (!session || (operationsRole === "dashboard_fuel_viewer" && pathname !== "/" && !pathname.startsWith("/fuel"))) return null;
  return <AccessRole.Provider value={operationsRole}><div className="app-frame">
    <NavBar operationsRole={operationsRole} payrollAccess={payrollAccess} fuelAccess={fuelAccess} />
    <div className="app-content">{children}</div>
  </div></AccessRole.Provider>;
}
