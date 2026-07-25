import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Lead, LeadStatus } from "@shared/outreach";
import { LEAD_STATUSES } from "@shared/outreach";
import { api } from "../../lib/api";
import { LeadStatusSelect } from "../../components/LeadStatusSelect";
import { outreachStatusLabel } from "../../lib/mode";

type SortKey =
  | "businessName"
  | "industry"
  | "location"
  | "status"
  | "priorityScore"
  | "nextFollowupAt"
  | "updatedAt";

export function OutreachListPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [industry, setIndustry] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("priorityScore");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLeads(await api.listLeads());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const industries = useMemo(
    () => [...new Set(leads.map((a) => a.industry).filter(Boolean) as string[])].sort(),
    [leads]
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = leads.filter((r) => {
      if (status && r.status !== status) return false;
      if (industry && r.industry !== industry) return false;
      if (query) {
        const hay = [
          r.businessName,
          r.industry ?? "",
          r.location ?? "",
          r.contactEmail ?? "",
          r.source ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const as = av == null ? "" : String(av);
      const bs = bv == null ? "" : String(bv);
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * sortDir;
      }
      if (as < bs) return -1 * sortDir;
      if (as > bs) return 1 * sortDir;
      return 0;
    });
    return list;
  }, [leads, q, status, industry, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "businessName" ? 1 : -1);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this lead? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await api.deleteLead(id);
      setLeads((a) => a.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  }

  async function onStatusChange(id: number, next: LeadStatus) {
    const lead = leads.find((a) => a.id === id);
    if (!lead || lead.status === next) return;
    const prev = leads;
    setStatusBusyId(id);
    setLeads((list) => list.map((a) => (a.id === id ? { ...a, status: next } : a)));
    try {
      await api.updateLead(id, { status: next });
    } catch (e) {
      setLeads(prev);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusyId(null);
    }
  }

  const th = (key: SortKey, label: string) => (
    <th onClick={() => toggleSort(key)}>
      {label}
      {sortKey === key ? (sortDir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="page-enter">
      <div className="page-head">
        <h1>Leads</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="muted">{filtered.length} shown</span>
          <a className="btn btn-ghost" href={api.exportLeadsCsvUrl()}>
            Export CSV
          </a>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search business, email, industry…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {outreachStatusLabel(s)}
            </option>
          ))}
        </select>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      <div className="panel table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {th("businessName", "Business")}
              {th("industry", "Industry")}
              {th("location", "Location")}
              {th("status", "Status")}
              {th("priorityScore", "Priority")}
              {th("nextFollowupAt", "Follow-up")}
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link to={`/outreach/leads/${l.id}`}>{l.businessName}</Link>
                </td>
                <td>{l.industry || "—"}</td>
                <td>{l.location || l.postcode || "—"}</td>
                <td>
                  <LeadStatusSelect
                    value={l.status}
                    disabled={statusBusyId === l.id}
                    onChange={(s) => onStatusChange(l.id, s)}
                  />
                </td>
                <td>{l.priorityScore?.toFixed(1) ?? "—"}</td>
                <td>{l.nextFollowupAt?.slice(0, 10) ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={deleting === l.id}
                    onClick={() => void onDelete(l.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="muted empty-pad">No leads match.</p>}
      </div>
    </div>
  );
}
