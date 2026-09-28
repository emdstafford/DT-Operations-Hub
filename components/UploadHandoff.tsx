"use client";

import { createContext, useContext, useRef } from "react";

export type UploadKind = "usps" | "fuel_comdata" | "fuel_contracts" | "timecards" | "holiday" | "schedule" | "unknown";
type Pending = { file: File; kind: UploadKind };
type Handoff = {
  put: (file: File, kind: UploadKind) => void;
  take: (kind: UploadKind) => File | null;
  peek: () => Pending | null;
  retarget: (kind: UploadKind) => void;
};
const Context = createContext<Handoff | null>(null);

export function UploadHandoffProvider({ children }: { children: React.ReactNode }) {
  const pending = useRef<Pending | null>(null);
  const value: Handoff = {
    put(file, kind) { pending.current = { file, kind }; },
    take(kind) {
      if (pending.current?.kind !== kind) return null;
      const file = pending.current.file;
      pending.current = null;
      return file;
    },
    peek() { return pending.current; },
    retarget(kind) { if (pending.current) pending.current.kind = kind; },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUploadHandoff() {
  const value = useContext(Context);
  if (!value) throw new Error("Upload handoff provider is missing.");
  return value;
}
