"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ContractPayRateLink() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase.rpc("is_contract_financial_user").then(({ data }) => {
      if (active) setAllowed(data === true);
    });
    return () => { active = false; };
  }, []);
  if (!allowed) return null;
  return <Link className="hub-secondary-link no-print" href="/contracts/pay-rates">Import and review pay rates →</Link>;
}
