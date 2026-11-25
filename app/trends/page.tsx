"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Daily = { operating_date: string; contract_number: string; weekday_number: number; load_count: number; distinct_trips: number; unmapped_loads: number; extra_loads: number; regular_loads: number; total_stops: number; completed_stops: number; incomplete_stops: number; unmapped_total_stops: number; unmapped_incomplete_stops: number };
type FourKitesWeek = { contract_number: string; period_start: string; period_end: string; total_loads: number; total_stops: number; geofence_stops: number; missing_geofence_stops: number; geofence_compliance_percent: number | null; source_version_count: number; source_file: string; exclude_from_performance: boolean };
type Trip = { operating_date: string; contract_number: string; trip_number: string; trip_type: string; weekday_number: number; load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number };
type TripNote = { id: string; contract_number: string; trip_number: string | null; note: string; status: string; effective_start: string; effective_end: string | null };
type LoadReviewNote = { load_number: string; operating_date: string; contract_number: string; trip_number: string; explanation: string; reason: string; review_status: string; ticket_status: string };
type Metric = { loads: number; stops: number; completed: number; incomplete: number };
const blank = (): Metric => ({ loads: 0, stops: 0, completed: 0, incomplete: 0 });
const pct = (complete: number, total: number) => total ? (100 * complete / total).toFixed(2) + "%" : "—";
const fmt = (n: number) => n.toLocaleString("en-US");
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const mondayOf = (date: string) => {
  const d = new Date(date + "T12:00:00Z");
  const weekday = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((weekday + 6) % 7));
  return dateOnly(d);
};
const shortDate = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", {month:"short",day:"numeric",timeZone:"UTC"});

const card: React.CSSProperties = { border: "1px solid #d9e1e5", borderRadius: 12, padding: 16, background: "var(--card-bg, #fff)" };
const field: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #aebac2", maxWidth: "100%" };
function add(m: Metric, v: { load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number }) {
  m.loads += Number(v.load_count || 0); m.stops += Number(v.total_stops || 0);
  m.completed += Number(v.completed_stops || 0); m.incomplete += Number(v.incomplete_stops || 0);
}
export default function ContractTrendsPage() {
  const [contracts, setContracts] = useState<string[]>([]);
  const [contract, setContract] = useState("");
  const [start, setStart] = useState(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 90); return dateOnly(d); });
  const [end, setEnd] = useState(() => dateOnly(new Date()));
  const [includeAugust, setIncludeAugust] = useState(false);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [fourkites, setFourkites] = useState<FourKitesWeek[]>([]);
  const [tripNotes, setTripNotes] = useState<TripNote[]>([]);
  const [reviewNotes, setReviewNotes] = useState<LoadReviewNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from("contract_master").select("contract_number").order("contract_number");
      if (!active) return;
      if (error) { setError(error.message); return; }
      const opts = [...new Set((data || []).map(x => String(x.contract_number || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      setContracts(opts); setContract(current => current || opts[0] || "");
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!contract || !start || !end) return;
    if (start > end) { setError("The start date must not be after the end date."); return; }
    let active = true; setLoading(true); setError("");
    void (async () => {
      try {
        const fetchRows = async (view: "dt_contract_daily_trends" | "dt_contract_trip_daily_trends") => {
          const rows: (Daily | Trip)[] = [];
          for (let offset = 0; offset < 25000; offset += 1000) {
            const result = await supabase.from(view).select("*").eq("contract_number", contract)
              .gte("operating_date", start).lte("operating_date", end)
              .order("operating_date").range(offset, offset + 999);
            if (result.error) throw result.error;
            const batch = (result.data || []) as (Daily | Trip)[];
            rows.push(...batch);
            if (batch.length < 1000) return rows;
          }
          throw new Error("Too many daily trend rows; choose a shorter date range.");
        };
        const [dayRows, tripRows, fk, savedTripNotes, savedReviewNotes] = await Promise.all([
          fetchRows("dt_contract_daily_trends"),
          fetchRows("dt_contract_trip_daily_trends"),
          supabase.from("dt_fourkites_contract_trends").select("*")
            .eq("contract_number", contract).lte("period_start", end)
            .gte("period_end", start).order("period_start"),
          supabase.from("operational_notes").select("id,contract_number,trip_number,note,status,effective_start,effective_end")
            .eq("contract_number",contract).lte("effective_start",end).or(`effective_end.is.null,effective_end.gte.${start}`).limit(1000),
          supabase.from("missed_load_reviews").select("load_number,operating_date,contract_number,trip_number,explanation,reason,review_status,ticket_status")
            .eq("contract_number",contract).gte("operating_date",start).lte("operating_date",end).limit(10000),
        ]);
        if (fk.error) throw fk.error;
        if (savedTripNotes.error) throw savedTripNotes.error;
        if (savedReviewNotes.error) throw savedReviewNotes.error;
        if (active) { setDaily(dayRows as Daily[]); setTrips(tripRows as Trip[]); setFourkites((fk.data || []) as FourKitesWeek[]); setTripNotes((savedTripNotes.data || []) as TripNote[]); setReviewNotes((savedReviewNotes.data || []) as LoadReviewNote[]); }
      } catch (e) { if (active) { setError(e instanceof Error ? e.message : String(e)); setDaily([]); setTrips([]); setFourkites([]); setTripNotes([]); setReviewNotes([]); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [contract, start, end]);
  const filteredDaily = useMemo(() => daily.filter(d => includeAugust || !(d.operating_date >= "2026-08-07" && d.operating_date <= "2026-08-13")), [daily, includeAugust]);
  const filteredTrips = useMemo(() => trips.filter(d => includeAugust || !(d.operating_date >= "2026-08-07" && d.operating_date <= "2026-08-13")), [trips, includeAugust]);
  const visibleFk = useMemo(() => fourkites.filter(w => includeAugust || !w.exclude_from_performance), [fourkites, includeAugust]);
  const summary = useMemo(() => { const m = blank(); filteredDaily.forEach(d => add(m, d)); return m; }, [filteredDaily]);
  const weekdays = useMemo(() => {
    const map = days.map(name => ({ name, ...blank(), dates: new Set<string>() }));
    for (const d of filteredDaily) { const x = map[d.weekday_number - 1]; if (x) { add(x, d); x.dates.add(d.operating_date); } }
    return map.map(x => ({ ...x, activeDays: x.dates.size }));
  }, [filteredDaily]);
  const tripStats = useMemo(() => {
    const map = new Map<string, Metric & { trip: string; type: string; days: Set<string> }>();
    for (const t of filteredTrips) {
      const k = t.trip_type + "|" + t.trip_number;
      const m = map.get(k) || { ...blank(), trip: t.trip_number, type: t.trip_type, days: new Set<string>() };
      add(m, t); m.days.add(t.operating_date); map.set(k, m);
    }
    return [...map.values()].sort((a, b) => b.incomplete - a.incomplete || b.loads - a.loads);
  }, [filteredTrips]);
  const recurringTrips = useMemo(() => {
    const map = new Map<string, { affected: Set<string>; observed: Set<string>; missedDays: Set<string>; missedStops: number }>();
    for (const t of filteredTrips) {
      const key = t.trip_type + "|" + t.trip_number;
      const record = map.get(key) || { affected: new Set<string>(), observed: new Set<string>(), missedDays: new Set<string>(), missedStops: 0 };
      const week = mondayOf(t.operating_date);
      record.observed.add(week);
      if (Number(t.incomplete_stops) > 0) {
        record.affected.add(week);
        record.missedDays.add(t.operating_date);
        record.missedStops += Number(t.incomplete_stops);
      }
      map.set(key, record);
    }
    return map;
  }, [filteredTrips]);
  const kinds = useMemo(() => ["regular", "extra"].map(type => {
    const m = blank(); tripStats.filter(x => x.type === type).forEach(x => { m.loads += x.loads; m.stops += x.stops; m.completed += x.completed; m.incomplete += x.incomplete; });
    return { type, ...m };
  }), [tripStats]);
  const notesForTrip = (trip: string) => tripNotes.filter(n => n.trip_number?.trim() === trip.trim() && filteredTrips.some(t => t.trip_number === trip && t.operating_date >= n.effective_start && (!n.effective_end || t.operating_date <= n.effective_end)));
  const reviewsForTrip = (trip: string) => reviewNotes.filter(n => n.trip_number?.trim() === trip.trim() && filteredTrips.some(t => t.trip_number === trip && t.operating_date === n.operating_date));
  const best = Math.max(1, ...weekdays.map(d => d.stops));
  const worst = weekdays.filter(x => x.stops > 0).sort((a, b) => a.completed / a.stops - b.completed / b.stops)[0];
  return <main className="page-shell" style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 18px 60px" }}>
    <p><Link href="/">← Operations Dashboard</Link></p>
    <header style={{ margin: "20px 0" }}>
      <p className="eyebrow">DT Intelligence Hub</p>
      <h1>Contract Trends</h1>
      <p>Find recurring missed stops, changing trip volumes, and weekday patterns for individual contracts.</p>
      <p style={{ fontSize: 13, opacity: .8 }}>Source: saved USPS operational loads. Stop completion is <strong>not</strong> FourKites geofence compliance.</p>
    </header>
    <section style={{ ...card, display: "flex", flexWrap: "wrap", alignItems: "end", gap: 16 }}>
      <label>Contract<br/><select style={field} value={contract} onChange={e => setContract(e.target.value)}>{contracts.map(c => <option value={c} key={c}>{c}</option>)}</select></label>
      <label>From<br/><input style={field} type="date" value={start} onChange={e => setStart(e.target.value)}/></label>
      <label>Through<br/><input style={field} type="date" value={end} onChange={e => setEnd(e.target.value)}/></label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 8 }}><input type="checkbox" checked={includeAugust} onChange={e => setIncludeAugust(e.target.checked)}/> Include flagged August 7–13 week</label>
    </section>
    {error && <p role="alert" style={{ color: "#b42318", marginTop: 16 }}>{error}</p>}
    {loading && <p style={{ padding: 20 }}>Loading saved contract performance…</p>}
    {!loading && !error && <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {[["Loads", fmt(summary.loads)], ["Scheduled stops", fmt(summary.stops)], ["Incomplete stops", fmt(summary.incomplete)], ["Completion", pct(summary.completed, summary.stops)]].map(([name, value]) => <div key={name} style={card}><div style={{ fontSize: 13, opacity: .7 }}>{name}</div><div style={{ fontSize: 28, fontWeight: 750 }}>{value}</div></div>)}
      </section>
      <section style={card}>
        <h2>Day-of-week patterns</h2>
        <p>Weighted by stops, not an average of daily percentages. Compare similar weekdays and review whether a problem repeats.</p>
        {worst && <p><strong>Lowest completion weekday:</strong> {worst.name} ({pct(worst.completed, worst.stops)} across {worst.activeDays} recorded dates)</p>}
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Day</th><th align="right">Recorded days</th><th align="right">Loads</th><th align="right">Stops</th><th align="right">Incomplete</th><th align="right">Completion</th></tr></thead><tbody>{weekdays.map(d => <tr key={d.name} style={{ borderTop: "1px solid #dce3e8" }}><td style={{ padding: "10px 4px" }}>{d.name}<div style={{ width: Math.round(110 * d.stops / best), height: 5, background: "#087f8c", borderRadius: 5 }}/></td><td align="right">{d.activeDays}</td><td align="right">{fmt(d.loads)}</td><td align="right">{fmt(d.stops)}</td><td align="right">{fmt(d.incomplete)}</td><td align="right"><strong>{pct(d.completed, d.stops)}</strong></td></tr>)}</tbody></table></div>
      </section>
      <section style={card}>
        <h2>Regular and extra trips</h2>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%" }}><thead><tr><th align="left">Trip category</th><th align="right">Loads</th><th align="right">Stops</th><th align="right">Incomplete</th><th align="right">Completion</th></tr></thead><tbody>{kinds.map(k => <tr key={k.type}><td style={{ textTransform: "capitalize" }}>{k.type}</td><td align="right">{fmt(k.loads)}</td><td align="right">{fmt(k.stops)}</td><td align="right">{fmt(k.incomplete)}</td><td align="right">{pct(k.completed,k.stops)}</td></tr>)}</tbody></table></div>
        <p style={{ fontSize: 13, opacity: .75 }}>Unmapped loads in this period: {fmt(filteredDaily.reduce((n, d) => n + Number(d.unmapped_loads || 0), 0))}. Unmapped loads are included in Extra Trips, consistent with the existing performance reports. They remain labeled Unmapped in the problem-trip list for follow-up.</p>
      </section>
      <section style={card}>
        <h2>FourKites geofence compliance — historical weeks</h2>
        <p>Separate from USPS stop completion above. These historical supplier exports cover 11 contracts. When multiple source versions exist for a reporting week, one is selected; originals are retained for audit.</p>
        {visibleFk.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th align="left">Week ending</th><th align="right">Loads</th><th align="right">Stops</th><th align="right">Missing geofence</th><th align="right">Compliance</th><th align="right">Versions</th></tr></thead>
          <tbody>{visibleFk.map(w => <tr key={w.period_start+"|"+w.period_end} style={{ borderTop: "1px solid #dce3e8" }}>
            <td style={{ padding: "9px 3px" }}>{w.period_end}{w.exclude_from_performance ? " (flagged)" : ""}</td>
            <td align="right">{fmt(w.total_loads)}</td><td align="right">{fmt(w.total_stops)}</td>
            <td align="right">{fmt(w.missing_geofence_stops)}</td>
            <td align="right"><strong>{w.geofence_compliance_percent === null ? "—" : Number(w.geofence_compliance_percent).toFixed(2)+"%"}</strong></td>
            <td align="right" title={w.source_file}>{w.source_version_count}{w.source_version_count > 1 ? " (review)" : ""}</td>
          </tr>)}</tbody>
        </table></div> : <p>No FourKites weekly contract exports for this contract and selected date range.</p>}
        {visibleFk.some(w => w.source_version_count > 1) && <p style={{ fontSize: 13, opacity: .8 }}>Overlapping uploads need review: for now this table selects the source with the latest available exception window, without adding both together.</p>}
      </section>
      <section style={card}>
        <h2>Saved notes for this contract</h2>
        <p>Read directly from the existing trip notes and missed-load reviews. Updating a note in its original editor will update this view on refresh.</p>
        {tripNotes.length === 0 && reviewNotes.length === 0 ? <p>No saved notes or reviewed loads in this date range.</p> : <div style={{ display: "grid", gap: 10 }}>
          {tripNotes.slice(0, 30).map(n => <div key={n.id} style={{ borderTop: "1px solid #dce3e8", paddingTop: 10 }}><strong>{n.trip_number || "Contract-wide note"}</strong> · {n.status.replaceAll("_"," ")} · {n.effective_start}{n.effective_end ? " to " + n.effective_end : " onward"}<p style={{ margin: "4px 0" }}>{n.note}</p></div>)}
          {reviewNotes.filter(n => n.explanation?.trim()).slice(0, 30).map(n => <div key={n.load_number+"|"+n.operating_date} style={{ borderTop: "1px solid #dce3e8", paddingTop: 10 }}><strong>Load {n.load_number}</strong> · {n.operating_date} · Trip {n.trip_number}<p style={{ margin: "4px 0" }}>{n.reason}: {n.explanation} ({n.review_status.replaceAll("_"," ")})</p></div>)}
        </div>}
        {(tripNotes.length > 30 || reviewNotes.length > 30) && <p>Showing recent saved notes here. Open Missed Load Reviews to see the complete filtered list.</p>}
      </section>
      <section style={card}>
        <h2>Repeated missed-stop weeks</h2>
        <p>Which trips have a recurring problem? Each week is counted once if the trip has at least one incomplete stop. Weeks here run Monday–Sunday; the counts use only dates with saved loads.</p>
        {tripStats.filter(t => (recurringTrips.get(t.type+"|"+t.trip)?.affected.size || 0) >= 2).sort((a,b) =>
          (recurringTrips.get(b.type+"|"+b.trip)?.affected.size || 0)-(recurringTrips.get(a.type+"|"+a.trip)?.affected.size || 0) || b.incomplete-a.incomplete).slice(0,12).map(t => {
          const r = recurringTrips.get(t.type+"|"+t.trip);
          return <div key={t.type+"|"+t.trip} style={{ padding: "11px 0", borderTop: "1px solid #dce3e8", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
            <div><strong>{t.trip}</strong> · {r?.affected.size} of {r?.observed.size} observed weeks with missed stops
              <div style={{ fontSize: 13, opacity: .8 }}>Weeks beginning {[...(r?.affected || [])].sort().map(shortDate).join(", ")} · {fmt(t.incomplete)} incomplete stops</div>
            </div>
            <Link href={`/missed-load-reviews?${new URLSearchParams({contract,trip:t.trip,start,end}).toString()}`}>Review loads →</Link>
          </div>;
        })}
        {!tripStats.some(t=>(recurringTrips.get(t.type+"|"+t.trip)?.affected.size||0)>=2) && <p>No trips with misses across two or more observed weeks for this contract and date range.</p>}
        <p style={{ marginTop: 12 }}><Link href="/recurring-missed-trips">Compare recurring trips across all contracts →</Link></p>
      </section>
      <section style={card}>
        <h2>Trips with the most incomplete stops</h2>
        <p>Each week with one or more incomplete stops counts once, regardless of how many loads were affected. Weeks start Monday. Select a trip to open its existing Missed Load Reviews with the same contract and date range.</p>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Trip</th><th align="left">Category</th><th align="right">Weeks with misses</th><th align="left">Weeks affected (Monday start)</th><th align="right">Days observed</th><th align="right">Loads</th><th align="right">Incomplete</th><th align="right">Completion</th></tr></thead><tbody>{tripStats.slice(0, 25).map(t => <tr style={{ borderTop: "1px solid #dce3e8" }} key={t.type+"|"+t.trip}><td style={{ padding: "8px 3px" }}><Link href={`/missed-load-reviews?${new URLSearchParams({contract,trip:t.trip,start,end}).toString()}`} title={`Review missed loads on trip ${t.trip}`}>{t.trip} ↗</Link>{notesForTrip(t.trip).length > 0 && <div style={{ fontSize: 12, marginTop: 3 }} title={notesForTrip(t.trip).map(n=>n.note).join(" • ")}>📝 {notesForTrip(t.trip).length} trip note(s)</div>}{reviewsForTrip(t.trip).length > 0 && <div style={{ fontSize: 12, marginTop: 3 }} title={reviewsForTrip(t.trip).map(n=>n.explanation).join(" • ")}>📋 {reviewsForTrip(t.trip).length} reviewed load(s)</div>}</td><td>{t.type}</td><td align="right"><strong>{recurringTrips.get(t.type+"|"+t.trip)?.affected.size ?? 0} of {recurringTrips.get(t.type+"|"+t.trip)?.observed.size ?? 0}</strong></td><td style={{ fontSize: 12, minWidth: 160 }}>{[...(recurringTrips.get(t.type+"|"+t.trip)?.affected ?? [])].sort().map(shortDate).join(", ") || "—"}</td><td align="right">{t.days.size}</td><td align="right">{fmt(t.loads)}</td><td align="right">{fmt(t.incomplete)}</td><td align="right">{pct(t.completed, t.stops)}</td></tr>)}</tbody></table></div>
        {!tripStats.length && <p>No saved trips for this contract and date range.</p>}
      </section>
    </div>}
  </main>;
}
