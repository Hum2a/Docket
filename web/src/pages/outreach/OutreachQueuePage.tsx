import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Lead } from "@shared/outreach";
import { api } from "../../lib/api";
import { outreachStatusLabel } from "../../lib/mode";
import { blockingTooltip, useOutreachPreflight } from "../../lib/useOutreachPreflight";

export function OutreachQueuePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { preflight, ready } = useOutreachPreflight();
  const sendBlockedTitle = ready ? undefined : blockingTooltip(preflight?.blocking ?? []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const all = await api.listLeads();
      setLeads(
        all
          .filter(
            (l) =>
              l.reviewReasons.length > 0 ||
              l.status === "queued" ||
              l.status === "demo_ready"
          )
          .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: number) {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await api.approveLead(id);
      setMessage(
        res.dryRun
          ? `Approved #${id} (dry run — message queued).`
          : res.ok === false
            ? `Approve blocked: ${(res.reasons || []).join(", ")}`
            : `Approved & sent #${id}.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function send(id: number) {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await api.sendLead(id);
      setMessage(
        res.ok === false
          ? `Send blocked: ${(res.reasons || []).join(", ")}`
          : res.dryRun
            ? `Queued dry-run message for #${id}.`
            : `Sent #${id}.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page-enter">
      <div className="page-head">
        <h1>Review queue</h1>
        <span className="muted">{leads.length} leads</span>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      <div className="panel table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Reasons</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link to={`/outreach/leads/${l.id}`}>{l.businessName}</Link>
                  <div className="meta">{l.contactEmail || "no email"}</div>
                </td>
                <td>{outreachStatusLabel(l.status)}</td>
                <td>{l.priorityScore?.toFixed(1) ?? "—"}</td>
                <td>
                  {l.reviewReasons.length > 0 ? (
                    <ul className="reason-list">
                      {l.reviewReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">Ready</span>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === l.id || !ready}
                      title={sendBlockedTitle}
                      onClick={() => void approve(l.id)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busyId === l.id || !ready}
                      title={sendBlockedTitle}
                      onClick={() => void send(l.id)}
                    >
                      Send
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <p className="muted empty-pad">Queue is empty — nothing needs review.</p>
        )}
      </div>
    </div>
  );
}
