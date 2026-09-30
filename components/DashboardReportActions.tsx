"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { classifyUpload } from "@/lib/classifyUpload";
import { useUploadHandoff } from "@/components/UploadHandoff";
import { supabase } from "@/lib/supabase";

export default function DashboardReportActions() {
  const router = useRouter();
  const handoff = useUploadHandoff();
  const [signedIn, setSignedIn] = useState(false);
  const [canManageReports, setCanManageReports] = useState(false);
  const [canFuel, setCanFuel] = useState(false);
  const [canPayroll, setCanPayroll] = useState(false);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email?.toLowerCase();
      if (!email) return;
      if (active) setSignedIn(true);
      const [operations, fuel, payroll] = await Promise.all([
        supabase.from("approved_users").select("role").eq("email", email).eq("active", true).maybeSingle(),
        supabase.from("fuel_tool_users").select("can_upload").eq("email", email).eq("active", true).maybeSingle(),
        supabase.from("payroll_tool_users").select("email").eq("email", email).eq("active", true).maybeSingle(),
      ]);
      if (active) {
        setCanManageReports(operations.data?.role === "admin" || operations.data?.role === "uploader");
        setCanFuel(Boolean(fuel.data?.can_upload));
        setCanPayroll(Boolean(payroll.data));
      }
    })();
    return () => { active = false; };
  }, []);

  async function chooseFile(file?: File) {
    if (!file) return;
    setReading(true);
    try {
      let kind = await classifyUpload(file);
      if ((kind === "fuel_comdata" || kind === "fuel_contracts") && !canFuel) kind = "unknown";
      if ((kind === "timecards" || kind === "holiday") && !canPayroll) kind = "unknown";
      handoff.put(file, kind);
      router.push(({ usps: "/upload", fuel_comdata: "/fuel", fuel_contracts: "/fuel", timecards: "/payroll/timecards", holiday: "/payroll/holiday-hours", schedule: "/schedule-builder", unknown: "/upload" } satisfies Record<typeof kind, string>)[kind]);
    } catch {
      handoff.put(file, "unknown"); router.push("/upload");
    } finally { setReading(false); }
  }

  if (!signedIn) return null;
  return <div className="hub-actions">
    <Link href="/reports/driver-contract-supervisor" className="hub-secondary-link">Driver / Contract / Supervisor</Link>
    {canManageReports && <><label className="primary-link dashboard-direct-upload">{reading ? "Reading file…" : "Upload a file"}<input type="file" accept=".xlsx,.xlsm,.xls,.csv,.pdf" disabled={reading} onChange={(event) => void chooseFile(event.target.files?.[0])} /></label><Link href="/upload" className="hub-secondary-link">All upload options</Link></>}
  </div>;
}
