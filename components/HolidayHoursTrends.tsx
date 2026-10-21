"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type HolidayEmployeeRow = {
  companyCode: string;
  fileNumber: string;
  employeeName: string;
  payClass: string;
  totalHours: number;
  holidayHours: number;
  sourceRows: number;
};

type HistoryRow = {
  id: string;
  holiday_name: string;
  holiday_date: string;
  source_file: string;
  source_rows: number;
  unique_employees: number;
  combined_source_hours: number;
  capped_at_eight: number;
  total_holiday_hours: number;
  processed_by_email: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by_email: string | null;
  employee_details: HolidayEmployeeRow[];
};

function decimal(value: number) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function average(total: number, count: number) {
  return count ? total / count : 0;
}

function csvValue(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default function HolidayHoursTrends() {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reload, setReload] = useState(0);
  const [openDetailsId, setOpenDetailsId] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [canDeleteArchived, setCanDeleteArchived] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const historyFields = "id, holiday_name, holiday_date, source_file, source_rows, unique_employees, combined_source_hours, capped_at_eight, total_holiday_hours, processed_by_email, created_at, updated_at, archived_at, archived_by_email";
      const detailedResult = await supabase
        .from("holiday_import_history")
        .select(`${historyFields}, employee_details`)
        .order("holiday_date", { ascending: false })
        .order("created_at", { ascending: false });
      let data = detailedResult.data as unknown as HistoryRow[] | null;
      let historyError = detailedResult.error;
      let migrationMissing = false;
      if (historyError?.code === "42703") {
        const legacyResult = await supabase
          .from("holiday_import_history")
          .select(historyFields)
          .order("holiday_date", { ascending: false })
          .order("created_at", { ascending: false });
        data = (legacyResult.data ?? []).map((row) => ({ ...row, employee_details: [] })) as unknown as HistoryRow[];
        historyError = legacyResult.error;
        migrationMissing = !legacyResult.error;
      }
      if (!active) return;
      if (historyError) {
        setError(historyError.message);
        setHistory([]);
      } else {
        setError(migrationMissing ? "Run supabase/holiday_employee_details.sql once to enable saved employee reports. Holiday totals remain available." : "");
        setHistory((data ?? []).map((row) => ({
          ...row,
          combined_source_hours: Number(row.combined_source_hours),
          total_holiday_hours: Number(row.total_holiday_hours),
          employee_details: Array.isArray(row.employee_details) ? row.employee_details.map((employee) => ({
            ...employee,
            totalHours: Number(employee.totalHours),
            holidayHours: Number(employee.holidayHours),
            sourceRows: Number(employee.sourceRows),
          })) : [],
        })));
      }
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user?.email) {
        const { data: access } = await supabase.from("payroll_tool_users")
          .select("can_delete_holiday_history")
          .eq("email", userData.user.email.toLowerCase())
          .eq("active", true)
          .maybeSingle();
        if (active) setCanDeleteArchived(Boolean(access?.can_delete_holiday_history));
      } else {
        setCanDeleteArchived(false);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [reload]);

  const activeHistory = useMemo(() => history.filter((row) => !row.archived_at), [history]);
  const archivedHistory = useMemo(() => history.filter((row) => Boolean(row.archived_at)), [history]);
  const years = useMemo(() => [...new Set(activeHistory.map((row) => row.holiday_date.slice(0, 4)))].sort().reverse(), [activeHistory]);
  const filtered = useMemo(() => activeHistory.filter((row) => {
    if (search && !row.holiday_name.toLowerCase().includes(search.toLowerCase().trim())) return false;
    if (year && row.holiday_date.slice(0, 4) !== year) return false;
    if (startDate && row.holiday_date < startDate) return false;
    if (endDate && row.holiday_date > endDate) return false;
    return true;
  }), [activeHistory, search, year, startDate, endDate]);

  const yearly = useMemo(() => {
    const groups = new Map<string, HistoryRow[]>();
    filtered.forEach((row) => {
      const key = row.holiday_date.slice(0, 4);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([key, rows]) => ({
      year: key,
      holidays: rows.length,
      averageEmployees: average(rows.reduce((sum, row) => sum + row.unique_employees, 0), rows.length),
      capped: rows.reduce((sum, row) => sum + row.capped_at_eight, 0),
      totalHours: rows.reduce((sum, row) => sum + row.total_holiday_hours, 0),
    }));
  }, [filtered]);

  const comparisons = useMemo(() => {
    const groups = new Map<string, HistoryRow[]>();
    filtered.forEach((row) => {
      const key = row.holiday_name.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return [...groups.values()].map((rows) => ({
      name: rows[0].holiday_name,
      occurrences: rows.length,
      averageEmployees: average(rows.reduce((sum, row) => sum + row.unique_employees, 0), rows.length),
      averageSourceHours: average(rows.reduce((sum, row) => sum + row.combined_source_hours, 0), rows.length),
      averageHolidayHours: average(rows.reduce((sum, row) => sum + row.total_holiday_hours, 0), rows.length),
      latest: rows.map((row) => row.holiday_date).sort().at(-1) ?? "",
    })).sort((left, right) => left.name.localeCompare(right.name));
  }, [filtered]);

  function updateRow(id: string, field: "holiday_name" | "holiday_date", value: string) {
    setHistory((current) => current.map((row) => row.id === id ? { ...row, [field]: value } : row));
  }

  async function saveRow(row: HistoryRow) {
    if (!row.holiday_name.trim() || !row.holiday_date) {
      setError("Holiday name and date are required.");
      return;
    }
    setError("");
    setMessage("");
    const { error: updateError } = await supabase.from("holiday_import_history").update({
      holiday_name: row.holiday_name.trim(),
      holiday_date: row.holiday_date,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (updateError) setError(updateError.message);
    else {
      setMessage(`${row.holiday_name.trim()} updated.`);
      setReload((value) => value + 1);
    }
  }

  async function archiveRow(row: HistoryRow) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("Your session expired. Sign in again before archiving.");
      return;
    }
    setError("");
    setMessage("");
    const { error: archiveError } = await supabase.from("holiday_import_history").update({
      archived_at: new Date().toISOString(),
      archived_by: userData.user.id,
      archived_by_email: userData.user.email?.toLowerCase(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (archiveError) setError(archiveError.code === "42703" ? "Run the updated holiday-history SQL once to enable archiving." : archiveError.message);
    else {
      setMessage(`${row.holiday_name} archived and removed from trend totals.`);
      setReload((value) => value + 1);
    }
  }

  async function restoreRow(row: HistoryRow) {
    setError("");
    setMessage("");
    const { error: restoreError } = await supabase.from("holiday_import_history").update({
      archived_at: null,
      archived_by: null,
      archived_by_email: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (restoreError) setError(restoreError.message);
    else {
      setMessage(`${row.holiday_name} restored.`);
      setReload((value) => value + 1);
    }
  }

  async function deleteArchivedRow(row: HistoryRow) {
    if (!canDeleteArchived || !row.archived_at) return;
    if (!window.confirm(`Permanently delete ${row.holiday_name} (${row.holiday_date}) from the archive? This cannot be undone.`)) return;
    setError("");
    setMessage("");
    const { error: deleteError } = await supabase.from("holiday_import_history")
      .delete()
      .eq("id", row.id)
      .eq("archived_at", row.archived_at);
    if (deleteError) setError(deleteError.message);
    else {
      setMessage(`${row.holiday_name} permanently deleted from the archive.`);
      setReload((value) => value + 1);
    }
  }

  function exportCsv() {
    const output = [
      ["Holiday Name", "Holiday Date", "Source Rows", "Unique Employees", "Combined Source Hours", "Capped at 8", "Total Holiday Hours", "Processed By", "Saved At"],
      ...filtered.map((row) => [row.holiday_name, row.holiday_date, row.source_rows, row.unique_employees, row.combined_source_hours.toFixed(2), row.capped_at_eight, row.total_holiday_hours.toFixed(2), row.processed_by_email, row.created_at]),
    ];
    const blob = new Blob([`${output.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "holiday_import_trends.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (loading) return <section className="panel holiday-history-empty">Loading holiday hours history…</section>;

  return <div className="payroll-trends-stack">
    {(error || message) && <section className={`panel ${error ? "payroll-error" : "holiday-history-success"}`}><strong>{error ? "Holiday Hours History" : "History updated"}</strong><span>{error || message}</span></section>}
    <section className="panel payroll-trend-filters">
      <label>Holiday search<input value={search} placeholder="Christmas" onChange={(event) => setSearch(event.target.value)} /></label>
      <label>Year<select value={year} onChange={(event) => setYear(event.target.value)}><option value="">All years</option>{years.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label>Through<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <button type="button" className="secondary-button" onClick={() => { setSearch(""); setYear(""); setStartDate(""); setEndDate(""); }}>Clear</button>
      <button type="button" className="upload-button" disabled={!filtered.length} onClick={exportCsv}>Export filtered CSV</button>
    </section>

    <section className="payroll-summary-grid" aria-label="Filtered holiday totals">
      <article><span>Holiday records</span><strong>{filtered.length.toLocaleString()}</strong></article>
      <article><span>Average employees</span><strong>{decimal(average(filtered.reduce((sum, row) => sum + row.unique_employees, 0), filtered.length))}</strong></article>
      <article><span>Combined source hours</span><strong>{decimal(filtered.reduce((sum, row) => sum + row.combined_source_hours, 0))}</strong></article>
      <article><span>Capped at 8</span><strong>{filtered.reduce((sum, row) => sum + row.capped_at_eight, 0).toLocaleString()}</strong></article>
      <article><span>Total holiday hours</span><strong>{decimal(filtered.reduce((sum, row) => sum + row.total_holiday_hours, 0))}</strong></article>
    </section>

    <section className="panel holiday-history-panel">
      <div className="panel-heading"><div><p className="eyebrow">Payroll trends</p><h2>Yearly and holiday comparison</h2><span>All figures below follow the filters above. Archived records are excluded.</span></div></div>
      {!filtered.length ? <p className="holiday-history-empty">No saved holidays match these filters.</p> : <div className="holiday-trend-grid">
        <div><h3>Yearly summary</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Year</th><th>Holidays</th><th>Avg. employees</th><th>Capped at 8</th><th>Total hours</th></tr></thead><tbody>{yearly.map((row) => <tr key={row.year}><td><strong>{row.year}</strong></td><td>{row.holidays}</td><td>{decimal(row.averageEmployees)}</td><td>{row.capped}</td><td>{decimal(row.totalHours)}</td></tr>)}</tbody></table></div></div>
        <div><h3>Holiday comparison</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Holiday</th><th>Years</th><th>Avg. employees</th><th>Avg. source hours</th><th>Avg. holiday hours</th><th>Latest</th></tr></thead><tbody>{comparisons.map((row) => <tr key={row.name.toLowerCase()}><td><strong>{row.name}</strong></td><td>{row.occurrences}</td><td>{decimal(row.averageEmployees)}</td><td>{decimal(row.averageSourceHours)}</td><td>{decimal(row.averageHolidayHours)}</td><td>{row.latest}</td></tr>)}</tbody></table></div></div>
      </div>}
      <h3 className="holiday-history-title">Saved imports</h3>
      <p className="privacy-note">Employee details are available only to employees approved for payroll tools. Older imports may not include employee details because they were saved before this feature.</p>
      <div className="table-scroll">
        <table className="data-table holiday-history-table">
          <thead><tr><th>Holiday name</th><th>Date</th><th>Source rows</th><th>Employees</th><th>Source hours</th><th>Capped</th><th>Holiday hours</th><th>Processed by</th><th></th></tr></thead>
          <tbody>
            {filtered.map((row) => {
              const query = employeeSearch.trim().toLocaleLowerCase();
              const matchingEmployees = row.employee_details.filter((employee) =>
                !query || employee.employeeName.toLocaleLowerCase().includes(query) || employee.fileNumber.toLocaleLowerCase().includes(query)
              );
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td><input aria-label="Holiday name" value={row.holiday_name} onChange={(event) => updateRow(row.id, "holiday_name", event.target.value)} /></td>
                    <td><input aria-label="Holiday date" type="date" value={row.holiday_date.slice(0, 10)} onChange={(event) => updateRow(row.id, "holiday_date", event.target.value)} /></td>
                    <td>{row.source_rows.toLocaleString()}</td>
                    <td>{row.unique_employees.toLocaleString()}</td>
                    <td>{decimal(row.combined_source_hours)}</td>
                    <td>{row.capped_at_eight.toLocaleString()}</td>
                    <td>{decimal(row.total_holiday_hours)}</td>
                    <td><span>{row.processed_by_email}</span><small>{new Date(row.created_at).toLocaleString()}</small></td>
                    <td>
                      <div className="holiday-history-actions">
                        <button type="button" className="secondary-button" onClick={() => void saveRow(row)}>Save</button>
                        <button type="button" className="archive-button" onClick={() => void archiveRow(row)}>Archive</button>
                      </div>
                      <button type="button" className="hub-secondary-link" aria-expanded={openDetailsId === row.id} onClick={() => { setOpenDetailsId(openDetailsId === row.id ? null : row.id); setEmployeeSearch(""); }}>
                        {openDetailsId === row.id ? "Hide employees" : "View employees"}
                      </button>
                    </td>
                  </tr>
                  {openDetailsId === row.id && (
                    <tr>
                      <td colSpan={9}>
                        <div className="holiday-employee-details">
                          <h4>{row.holiday_name} employee details</h4>
                          {row.employee_details.length ? (
                            <>
                              <label>Search employees by name or file number<input type="search" value={employeeSearch} placeholder="Name or file number" onChange={(event) => setEmployeeSearch(event.target.value)} /></label>
                              <div className="table-scroll">
                                <table className="data-table">
                                  <thead><tr><th>Employee</th><th>File #</th><th>Pay class</th><th>Source hours</th><th>Source rows</th><th>Holiday hours</th></tr></thead>
                                  <tbody>
                                    {matchingEmployees.map((employee) => (
                                      <tr key={employee.companyCode + "-" + employee.fileNumber}>
                                        <td>{employee.employeeName}</td><td>{employee.fileNumber}</td><td>{employee.payClass}</td><td>{decimal(employee.totalHours)}</td><td>{employee.sourceRows}</td><td><strong>{decimal(employee.holidayHours)}</strong></td>
                                      </tr>
                                    ))}
                                    {!matchingEmployees.length && <tr><td colSpan={6}>No employees match that name or file number.</td></tr>}
                                  </tbody>
                                </table>
                              </div>
                              <p>{matchingEmployees.length.toLocaleString()} employees shown of {row.employee_details.length.toLocaleString()}.</p>
                            </>
                          ) : (
                            <p>Employee details were not saved with this older import. Re-upload its original CSV and save the holiday again to add the employee report.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {archivedHistory.length > 0 && <details className="holiday-archive"><summary>Archived records ({archivedHistory.length})</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Holiday</th><th>Date</th><th>Employees</th><th>Holiday hours</th><th>Archived by</th><th></th></tr></thead><tbody>{archivedHistory.map((row) => <tr key={row.id}><td>{row.holiday_name}</td><td>{row.holiday_date}</td><td>{row.unique_employees.toLocaleString()}</td><td>{decimal(row.total_holiday_hours)}</td><td>{row.archived_by_email || "Payroll user"}</td><td><div className="holiday-history-actions"><button type="button" className="secondary-button" onClick={() => void restoreRow(row)}>Restore</button>{canDeleteArchived && <button type="button" className="archive-button" onClick={() => void deleteArchivedRow(row)}>Delete permanently</button>}</div></td></tr>)}</tbody></table></div></details>}
    </section>
  </div>;
}
