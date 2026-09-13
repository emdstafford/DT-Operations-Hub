"use client";

import { useState } from "react";
import { processOperationalExceptions } from "@/lib/processOperationalExceptions";
import { saveOperationalExceptions } from "@/lib/saveOperationalExceptions";

export default function OperationalExceptionsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");

  async function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) return;

    setFileName(file.name);

    const result =
      await processOperationalExceptions(
        file
      );

    setRows(result);
  }

  async function handleSave() {
    try {
      const count =
        await saveOperationalExceptions(
          rows
        );

      alert(
        `${count} operational exceptions saved`
      );
    } catch (error: any) {
      console.error(error);

      alert(
        error?.message ||
        "Import failed"
      );
    }
  }

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-6">
        Operational Exceptions
      </h1>

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileSelect}
      />

      {fileName && (
        <div className="mt-4">
          File: {fileName}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="mt-4">
            Rows Found: {rows.length}
          </div>

          <button
            onClick={handleSave}
            className="bg-blue-500 text-white px-4 py-2 rounded mt-4"
          >
            Import Exceptions
          </button>
        </>
      )}
    </main>
  );
}