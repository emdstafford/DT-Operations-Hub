"use client";

import { useEffect, useState } from "react";

function contractLabel(section: Element) {
  const heading = section.querySelector("h2")?.textContent?.trim() || "";
  return heading.replace(/^Contract\s+/i, "").trim();
}

export default function TimecardPrintControls() {
  const [contracts, setContracts] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const scan = () => {
      const values = [...document.querySelectorAll(".timecard-packet .timecard-contract")].map(contractLabel).filter(Boolean);
      const unique = [...new Set(values)];
      setContracts(unique);
      setSelected((current) => current.length ? current.filter((value) => unique.includes(value)) : unique);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!contracts.length) return null;

  function print(selection: string[]) {
    const allowed = new Set(selection);
    const sections = [...document.querySelectorAll<HTMLElement>(".timecard-packet .timecard-contract")];
    const changed: Array<{ node: HTMLElement; display: string }> = [];
    for (const section of sections) {
      if (!allowed.has(contractLabel(section))) {
        changed.push({ node: section, display: section.style.display });
        section.style.display = "none";
      }
    }
    const restore = () => {
      changed.forEach(({ node, display }) => { node.style.display = display; });
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.setTimeout(() => window.print(), 100);
  }

  const allSelected = selected.length === contracts.length;
  return <section className="panel no-print" style={{ marginBottom: 18 }}>
    <div className="panel-heading"><div><h2>Print contracts</h2><span>Print the entire uploaded payroll packet, one contract, or any combination of contracts.</span></div></div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <button type="button" className="primary-link" onClick={() => print(contracts)}>Print all contracts</button>
      <button type="button" className="hub-secondary-link" disabled={!selected.length} onClick={() => print(selected)}>Print selected ({selected.length})</button>
      <button type="button" className="hub-secondary-link" onClick={() => setSelected(allSelected ? [] : contracts)}>{allSelected ? "Clear selection" : "Select all"}</button>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
      {contracts.map((contract) => <label key={contract} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #d7e0ea", borderRadius: 8, background: "#f8fafc" }}><input type="checkbox" checked={selected.includes(contract)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, contract])] : current.filter((value) => value !== contract))}/><strong>{contract}</strong></label>)}
    </div>
  </section>;
}
