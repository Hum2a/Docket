import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Lead } from "@shared/outreach";
import { api } from "../../lib/api";
import { outreachStatusLabel } from "../../lib/mode";
import { ContactRouteChip } from "../../components/ContactRouteChip";
import { SendEmailButton } from "../../components/SendEmailButton";
import { blockingTooltip, useOutreachPreflight } from "../../lib/useOutreachPreflight";

type Preview = {
  subject: string;
  text: string;
  source: string;
};

export function OutreachQueuePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [previews, setPreviews] = useState<Record<number, Preview | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { preflight, ready } = useOutreachPreflight();
  const sendBlockedTitle = ready ? undefined : blockingTooltip(preflight?.blocking ?? []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await api.listLeads({ limit: "200" });
      const filtered = page.leads
        .filter(
          (l) =>
            l.reviewReasons.length > 0 ||
            l.status === "queued" ||
            l.status === "demo_ready"
        )
        .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
      setLeads(filtered);
      const entries = await Promise.all(
        filtered.map(async (l) => {
          try {
            const p = await api.getOutreachPreview(l.id);
            return [l.id, { subject: p.subject, text: p.text, source: p.source }] as const;
          } catch {
            return [l.id, null] as const;
          }
        })
      );
      setPreviews(Object.fromEntries(entries));
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

      <div className="queue-list">
        {leads.map((l) => {
          const preview = previews[l.id];
          return (
            <article key={l.id} className="panel" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <Link to={`/outreach/leads/${l.id}`}>
                    <strong>{l.businessName}</strong>
                  </Link>
                  <div className="meta" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <ContactRouteChip route={l.contactRoute} />
                    <span>
                      {l.contactEmail || "no email"} · {outreachStatusLabel(l.status)} · priority{" "}
                      {l.priorityScore?.toFixed(1) ?? "—"}
                    </span>
                  </div>
                  {l.reviewReasons.length > 0 ? (
                    <ul className="reason-list" style={{ marginTop: "0.5rem" }}>
                      {l.reviewReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted" style={{ marginTop: "0.5rem" }}>
                      Ready
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  <SendEmailButton lead={l} onDone={() => void load()} />
                  <button
                    type="button"
                    className="btn btn-ghost"
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
              </div>

              <div style={{ marginTop: "1rem" }}>
                <div className="meta">
                  Email to send
                  {preview ? ` · ${preview.source}` : ""}
                </div>
                {preview ? (
                  <>
                    <p style={{ margin: "0.35rem 0" }}>
                      <strong>{preview.subject}</strong>
                    </p>
                    <pre
                      className="audit-json"
                      style={{ whiteSpace: "pre-wrap", maxHeight: "220px", overflow: "auto" }}
                    >
                      {preview.text}
                    </pre>
                  </>
                ) : (
                  <p className="muted">Preview unavailable — open the lead to review copy.</p>
                )}
              </div>
            </article>
          );
        })}
        {leads.length === 0 && (
          <p className="muted empty-pad">Queue is empty — nothing needs review.</p>
        )}
      </div>
    </div>
  );
}
