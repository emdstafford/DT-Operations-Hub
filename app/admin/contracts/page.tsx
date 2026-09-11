"use client";

import { useState } from "react";
import { importContracts } from "@/lib/processors/contractImporter";

export default function ContractAdminPage() {
  const [sheetNames, setSheetNames] = useState<string[]>([]);

  async function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) return;

    const result = await importContracts(file);

    setSheetNames(result);
  }

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">
        Sheet Test
      </h1>

      <input
        type="file"
        accept=".xlsx,.xlsm"
        onChange={handleFileSelect}
      />

      <ul className="mt-6">
        {sheetNames.map((sheet) => (
          <li key={sheet}>{sheet}</li>
        ))}
      </ul>
    </main>
  );
}