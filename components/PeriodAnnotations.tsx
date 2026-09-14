"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Annotation = {
  id: string;
  title: string;
  note: string;
  period_start: string;
  period_end: string;
};

export default function PeriodAnnotations({ start, end }: { start: string; end: string }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("report_annotations")
        .select("id,title,note,period_start,period_end")
        .lte("period_start", end)
        .gte("period_end", start)
        .order("period_start", { ascending: true });
      setAnnotations((data ?? []) as Annotation[]);
    })();
  }, [start, end]);

  if (!annotations.length) return null;

  return <div className="report-stack">
    {annotations.map((annotation) => <div className="alert" key={annotation.id}>
      <strong>{annotation.title}:</strong> {annotation.note}
    </div>)}
  </div>;
}
