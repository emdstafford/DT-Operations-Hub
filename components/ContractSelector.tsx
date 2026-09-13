"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ContractSelector() {
  const router = useRouter();
  const [contracts, setContracts] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const result = await supabase.rpc("contract_options");
      if (result.error) setError(result.error.message);
      else setContracts((result.data ?? []).map((row: { contract_number: string }) => row.contract_number));
      setLoading(false);
    })();
  }, []);

  return <section className="panel">
    <div className="panel-heading">
      <div><h2>Choose a contract</h2><span>Open its daily, weekly, monthly, and yearly results.</span></div>
    </div>
    {error && <div className="alert alert-error">{error}</div>}
    <div className="filter-bar">
      <label>Contract
        <select
          value={selected}
          disabled={loading}
          onChange={(event) => {
            const contract = event.target.value;
            setSelected(contract);
            if (contract) router.push(`/contracts/${encodeURIComponent(contract)}`);
          }}
        >
          <option value="">{loading ? "Loading contracts…" : "Select a contract"}</option>
          {contracts.map((contract) => <option key={contract} value={contract}>{contract}</option>)}
        </select>
      </label>
    </div>
  </section>;
}
