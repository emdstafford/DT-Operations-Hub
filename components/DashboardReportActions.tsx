"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function DashboardReportActions() {
  const [canManageReports, setCanManageReports] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email?.toLowerCase();
      if (!email) return;

      const { data } = await supabase
        .from("approved_users")
        .select("role")
        .eq("email", email)
        .eq("active", true)
        .maybeSingle();

      if (active) {
        setCanManageReports(data?.role === "admin" || data?.role === "uploader");
      }
    })();

    return () => { active = false; };
  }, []);

  if (!canManageReports) return null;

  return <div className="hub-actions">
    <Link href="/upload" className="primary-link">Upload report</Link>
    <Link href="/operational-exceptions" className="hub-secondary-link">Missed stops</Link>
  </div>;
}
