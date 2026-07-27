import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Lead, LeadStatus } from "@shared/outreach";
import { api, type LeadMessage, type LeadNote, type LeadReminder } from "../../lib/api";
import { LeadStatusSelect } from "../../components/LeadStatusSelect";
import { ContactRouteChip } from "../../components/ContactRouteChip";
import { DemoChip } from "../../components/DemoChip";
import { SendEmailButton } from "../../components/SendEmailButton";
import { blockingTooltip, useOutreachPreflight } from "../../lib/useOutreachPreflight";
import { outreachStatusLabel } from "../../lib/mode";

type SendReadiness = {
  ok: boolean;
  labels: string[];
  blocking: string[];
  dryRun: boolean;
};

function formatSendFlash(res: {
  sent?: boolean;
  dryRun?: boolean;
  reasons?: string[];
  error?: string;
  approved?: boolean;
}): string {
  if (res.sent) return res.approved ? "Approved & sent." : "Sent.";
  if (res.dryRun) return res.approved ? "Approved (dry run — message queued)." : "Queued dry-run message.";
  const why = (res.reasons || []).join(", ") || res.error || "send failed";
  return res.approved ? `Approve blocked: ${why}` : `Send blocked: ${why}`;
}

function DraftPanel({
  lead,
  onLeadUpdated,
  onError,
}: {
  lead: Lead;
  onLeadUpdated: (lead: Lead) => void;
  onError: (msg: string | null) => void;
}) {
  const hasCustom = Boolean(lead.customBody?.trim());
  const [editing, setEditing] = useState(hasCustom);
  const [subject, setSubject] = useState(lead.customSubject ?? "");
  const [body, setBody] = useState(lead.customBody ?? "");
  const [preview, setPreview] = useState<{
    subject: string;
    text: string;
    source: string;
    bodyBeforeFooter: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = useCallback(async () => {
    try {
      const p = await api.getOutreachPreview(lead.id);
      setPreview(p);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [lead.id, onError]);

  useEffect(() => {
    setEditing(Boolean(lead.customBody?.trim()));
    setSubject(lead.customSubject ?? "");
    setBody(lead.customBody ?? "");
    void loadPreview();
  }, [lead.id, lead.customBody, lead.customSubject, loadPreview]);

  async function saveDraft() {
    setBusy(true);
    onError(null);
    try {
      const updated = await api.updateLead(lead.id, {
        customSubject: subject.trim() || null,
        customBody: body.trim() || null,
      });
      onLeadUpdated(updated);
      setEditing(Boolean(updated.customBody?.trim()));
      await loadPreview();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function startFromGenerated() {
    setBusy(true);
    onError(null);
    try {
      const p = await api.getOutreachPreview(lead.id);
      let before = p.bodyBeforeFooter;
      if (p.source === "custom") {
        const cleared = await api.updateLead(lead.id, {
          customSubject: null,
          customBody: null,
        });
        onLeadUpdated(cleared);
        const gen = await api.getOutreachPreview(lead.id);
        before = gen.bodyBeforeFooter;
        setSubject(gen.subject);
      } else {
        setSubject(p.subject);
      }
      setBody(before);
      setEditing(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearDraft() {
    setBusy(true);
    onError(null);
    try {
      const updated = await api.updateLead(lead.id, {
        customSubject: null,
        customBody: null,
      });
      onLeadUpdated(updated);
      setSubject("");
      setBody("");
      setEditing(false);
      await loadPreview();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel draft-panel">
      <h2>Draft</h2>
      <p className="muted">
        Hand-written copy overrides the generated initial email. The system still appends the postal
        address and unsubscribe footer on send.
      </p>

      {!editing && preview?.source === "generated" ? (
        <div className="form-grid" style={{ marginTop: "0.85rem" }}>
          <p className="meta" style={{ gridColumn: "1 / -1" }}>
            Showing <strong>generated</strong> copy (read-only)
          </p>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor={`draft-subject-ro-${lead.id}`}>Subject</label>
            <input id={`draft-subject-ro-${lead.id}`} value={preview.subject} readOnly />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor={`draft-body-ro-${lead.id}`}>Body</label>
            <textarea id={`draft-body-ro-${lead.id}`} rows={10} value={preview.bodyBeforeFooter} readOnly />
          </div>
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void startFromGenerated()}>
              Edit as custom draft
            </button>
          </div>
        </div>
      ) : (
        <div className="form-grid" style={{ marginTop: "0.85rem" }}>
          <p className="meta" style={{ gridColumn: "1 / -1" }}>
            {hasCustom ? "Custom draft" : "Editing custom draft"}
            {lead.draftUpdatedAt ? ` · updated ${lead.draftUpdatedAt.slice(0, 19)}` : ""}
          </p>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor={`draft-subject-${lead.id}`}>Subject</label>
            <input
              id={`draft-subject-${lead.id}`}
              value={subject}
              disabled={busy}
              placeholder="Leave blank to use generated subject"
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor={`draft-body-${lead.id}`}>Body</label>
            <textarea
              id={`draft-body-${lead.id}`}
              rows={10}
              value={body}
              disabled={busy}
              placeholder="Hand-written email body (no footer — that is appended automatically)"
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveDraft()}>
              Save draft
            </button>
            {hasCustom && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void clearDraft()}>
                Clear custom draft
              </button>
            )}
          </div>
        </div>
      )}

      {preview && (
        <div>
          <div className="draft-preview-head">
            <h3>Preview as sent</h3>
            <span className="meta">
              {preview.subject} · {preview.source}
            </span>
          </div>
          <pre className="audit-json draft-preview-body">{preview.text}</pre>
        </div>
      )}
    </section>
  );
}

export function OutreachDetailPage() {
  const { id } = useParams();
  const leadId = Number(id);
  const navigate = useNavigate();
  const { preflight, ready } = useOutreachPreflight();
  const sendBlockedTitle = ready ? undefined : blockingTooltip(preflight?.blocking ?? []);

  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [reminders, setReminders] = useState<LeadReminder[]>([]);
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [readiness, setReadiness] = useState<SendReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [remForm, setRemForm] = useState({ dueDate: "", message: "" });
  const [addingRem, setAddingRem] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashOk, setFlashOk] = useState(true);

  const loadReadiness = useCallback(async (idNum: number) => {
    try {
      const r = await api.getSendReadiness(idNum);
      setReadiness({
        ok: r.ok,
        labels: r.labels,
        blocking: r.blocking,
        dryRun: r.dryRun,
      });
    } catch (e) {
      setReadiness({
        ok: false,
        labels: [e instanceof Error ? e.message : String(e)],
        blocking: [],
        dryRun: false,
      });
    }
  }, []);

  const load = useCallback(async () => {
    if (!Number.isInteger(leadId)) return;
    setError(null);
    try {
      const [l, n, r, m] = await Promise.all([
        api.getLead(leadId),
        api.listLeadNotes(leadId),
        api.listLeadReminders(leadId),
        api.listLeadMessages(leadId),
      ]);
      setLead(l);
      setNotes(n);
      setReminders(r);
      setMessages(m);
      void loadReadiness(leadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [leadId, loadReadiness]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateLead(lead.id, {
        businessName: lead.businessName,
        industry: lead.industry,
        location: lead.location,
        postcode: lead.postcode,
        contactName: lead.contactName,
        contactEmail: lead.contactEmail,
        contactPhone: lead.contactPhone,
        websiteUrl: lead.websiteUrl,
        demoUrl: lead.demoUrl,
        needScore: lead.needScore,
        likelihoodScore: lead.likelihoodScore,
        priorityScore: lead.priorityScore,
        scoreReason: lead.scoreReason,
        status: lead.status,
        offerAmount: lead.offerAmount,
        corporateSubscriber: lead.corporateSubscriber,
        emailVerified: lead.emailVerified,
      });
      setLead(updated);
      setFlashOk(true);
      setFlash("Saved.");
      void loadReadiness(updated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveStatus(next: LeadStatus) {
    if (!lead || lead.status === next) return;
    const previous = lead.status;
    setLead({ ...lead, status: next });
    setStatusSaving(true);
    setError(null);
    try {
      const updated = await api.updateLead(lead.id, { status: next });
      setLead(updated);
      void loadReadiness(updated.id);
    } catch (err) {
      setLead({ ...lead, status: previous });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatusSaving(false);
    }
  }

  async function onDelete() {
    if (!lead || !confirm("Delete this lead? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.deleteLead(lead.id);
      navigate("/outreach");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setAddingNote(true);
    try {
      const note = await api.createLeadNote(leadId, noteBody.trim());
      setNotes((list) => [note, ...list]);
      setNoteBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingNote(false);
    }
  }

  async function addReminder(e: React.FormEvent) {
    e.preventDefault();
    if (!remForm.dueDate || !remForm.message.trim()) return;
    setAddingRem(true);
    try {
      const rem = await api.createLeadReminder(leadId, remForm.dueDate, remForm.message.trim());
      setReminders((list) => [rem, ...list]);
      setRemForm({ dueDate: "", message: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingRem(false);
    }
  }

  async function runSend(approve: boolean) {
    setActionBusy(true);
    setFlash(null);
    setError(null);
    try {
      const res = approve ? await api.approveLead(leadId) : await api.sendLead(leadId);
      const ok = res.sent === true || res.dryRun === true;
      setFlashOk(ok);
      setFlash(formatSendFlash({ ...res, approved: approve }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  if (!lead && !error) return <p className="muted page-enter">Loading…</p>;
  if (!lead) return <div className="error-banner">{error}</div>;

  const latestFailedOut = [...messages]
    .reverse()
    .find((m) => m.direction === "out" && m.status === "failed");

  const place = [lead.industry, lead.location || lead.postcode].filter(Boolean).join(" · ");
  const readinessBlocked =
    readiness && !readiness.ok
      ? readiness.blocking.length
        ? readiness.blocking
        : readiness.labels
      : [];

  return (
    <div className="page-enter detail-page">
      <p className="muted" style={{ margin: "0 0 0.65rem" }}>
        <Link to="/outreach" className="muted">
          ← Board
        </Link>
      </p>

      <section className="panel lead-summary">
        <div className="lead-summary-top">
          <div>
            <h1>{lead.businessName}</h1>
            <div className="lead-summary-chips">
              <ContactRouteChip route={lead.contactRoute} />
              <DemoChip
                demoStatus={lead.demoStatus}
                demoUrl={lead.demoUrl}
                demoExpiresAt={lead.demoExpiresAt}
              />
              <span className="badge" style={{ background: "var(--surface)", color: "var(--muted)" }}>
                {outreachStatusLabel(lead.status)}
              </span>
            </div>
          </div>
          <ul className="score-pills" aria-label="Scores">
            <li>
              Need <strong>{lead.needScore?.toFixed(1) ?? "—"}</strong>
            </li>
            <li>
              Likelihood <strong>{lead.likelihoodScore?.toFixed(1) ?? "—"}</strong>
            </li>
            <li>
              Priority <strong>{lead.priorityScore?.toFixed(1) ?? "—"}</strong>
            </li>
          </ul>
        </div>

        <div className="lead-summary-meta">
          <span>
            Email <strong>{lead.contactEmail || "—"}</strong>
          </span>
          {place ? (
            <span>
              About <strong>{place}</strong>
            </span>
          ) : null}
          <span>
            Sent <strong>{lead.sentAt?.slice(0, 10) ?? "—"}</strong>
          </span>
          <span>
            Reply{" "}
            <strong>
              {lead.repliedAt?.slice(0, 10) ?? "—"}
              {lead.replySentiment ? ` (${lead.replySentiment})` : ""}
            </strong>
          </span>
          {lead.demoExpiresAt ? (
            <span>
              Demo expires <strong>{lead.demoExpiresAt.slice(0, 10)}</strong>
            </span>
          ) : null}
        </div>

        {readiness && (
          <div className={`lead-readiness ${readiness.ok ? "ok" : "blocked"}`} role="status">
            {readiness.ok
              ? readiness.dryRun
                ? "Ready to send (dry run is on — message will queue, not go live)."
                : "Ready to send."
              : `Not ready: ${readinessBlocked.join("; ") || "fix blockers"}`}
          </div>
        )}
      </section>

      <div className="panel lead-action-bar">
        <div className="lead-action-bar-primary">
          <LeadStatusSelect
            value={lead.status}
            disabled={statusSaving}
            onChange={(s) => void saveStatus(s)}
          />
          <SendEmailButton
            lead={lead}
            className="btn btn-primary"
            onDone={() => void load()}
          />
        </div>
        <div className="lead-action-bar-secondary">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={actionBusy || !ready}
            title={sendBlockedTitle}
            onClick={() => void runSend(true)}
          >
            Approve & send
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={actionBusy || !ready}
            title={sendBlockedTitle}
            onClick={() => void runSend(false)}
          >
            Send
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={deleting}
            onClick={() => void onDelete()}
          >
            Delete
          </button>
        </div>
      </div>

      {latestFailedOut && (
        <div className="error-banner" role="alert">
          <div style={{ marginBottom: "0.5rem" }}>
            Last send failed
            {latestFailedOut.error ? `: ${latestFailedOut.error}` : "."}
          </div>
          <SendEmailButton lead={lead} buttonLabel="Retry send" onDone={() => void load()} />
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {flash && (flashOk ? <div className="success-banner">{flash}</div> : <div className="error-banner">{flash}</div>)}

      {lead.reviewReasons.length > 0 && (
        <div className="panel section" style={{ marginBottom: "0.85rem" }}>
          <h2>Review reasons</h2>
          <ul className="reason-list">
            {lead.reviewReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <DraftPanel lead={lead} onLeadUpdated={setLead} onError={setError} />

      <div className="detail-grid">
        <form className="panel section form-grid" onSubmit={(e) => void save(e)}>
          <h2 style={{ gridColumn: "1 / -1" }}>Lead</h2>

          <div className="field">
            <label htmlFor="lead-business-name">Business name</label>
            <input
              id="lead-business-name"
              value={lead.businessName}
              onChange={(e) => setLead({ ...lead, businessName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-industry">Industry</label>
            <input
              id="lead-industry"
              value={lead.industry ?? ""}
              onChange={(e) => setLead({ ...lead, industry: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-location">Location</label>
            <input
              id="lead-location"
              value={lead.location ?? ""}
              onChange={(e) => setLead({ ...lead, location: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-postcode">Postcode</label>
            <input
              id="lead-postcode"
              value={lead.postcode ?? ""}
              onChange={(e) => setLead({ ...lead, postcode: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-contact-name">Contact name</label>
            <input
              id="lead-contact-name"
              value={lead.contactName ?? ""}
              onChange={(e) => setLead({ ...lead, contactName: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-contact-email">Contact email</label>
            <input
              id="lead-contact-email"
              value={lead.contactEmail ?? ""}
              onChange={(e) => setLead({ ...lead, contactEmail: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-phone">Phone</label>
            <input
              id="lead-phone"
              value={lead.contactPhone ?? ""}
              onChange={(e) => setLead({ ...lead, contactPhone: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-website">Website</label>
            <input
              id="lead-website"
              value={lead.websiteUrl ?? ""}
              onChange={(e) => setLead({ ...lead, websiteUrl: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-demo-url">Demo URL</label>
            <input
              id="lead-demo-url"
              value={lead.demoUrl ?? ""}
              onChange={(e) => setLead({ ...lead, demoUrl: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="lead-need">Need score</label>
            <input
              id="lead-need"
              type="number"
              step="0.1"
              value={lead.needScore ?? ""}
              onChange={(e) =>
                setLead({
                  ...lead,
                  needScore: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="lead-likelihood">Likelihood</label>
            <input
              id="lead-likelihood"
              type="number"
              step="0.1"
              value={lead.likelihoodScore ?? ""}
              onChange={(e) =>
                setLead({
                  ...lead,
                  likelihoodScore: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="lead-priority">Priority</label>
            <input
              id="lead-priority"
              type="number"
              step="0.1"
              value={lead.priorityScore ?? ""}
              onChange={(e) =>
                setLead({
                  ...lead,
                  priorityScore: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="lead-score-reason">Score reason</label>
            <textarea
              id="lead-score-reason"
              rows={2}
              value={lead.scoreReason ?? ""}
              onChange={(e) => setLead({ ...lead, scoreReason: e.target.value || null })}
            />
          </div>

          <div className="pecr-block">
            <span className="pecr-label">Send flags (PECR)</span>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={lead.corporateSubscriber}
                onChange={(e) => setLead({ ...lead, corporateSubscriber: e.target.checked })}
              />
              Corporate subscriber (PECR)
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={lead.emailVerified}
                onChange={(e) => setLead({ ...lead, emailVerified: e.target.checked })}
              />
              Email verified
            </label>
          </div>

          <div className="field">
            <label htmlFor="lead-offer">Offer amount</label>
            <input
              id="lead-offer"
              type="number"
              value={lead.offerAmount}
              onChange={(e) => setLead({ ...lead, offerAmount: Number(e.target.value) || 0 })}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>

        <div className="detail-side">
          <section className="panel section">
            <h2>Audit</h2>
            {lead.scoreReason ? <p className="meta">{lead.scoreReason}</p> : null}
            <details className="audit-details">
              <summary>Raw audit JSON</summary>
              <pre className="audit-json">{JSON.stringify(lead.audit, null, 2)}</pre>
            </details>
          </section>

          <section className="panel section">
            <h2>Message thread</h2>
            {messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : (
              <ul className="thread-list">
                {messages.map((m) => (
                  <li key={m.id} className="thread-item">
                    <strong>
                      {m.direction} · {m.status}
                    </strong>
                    <div className="meta">{m.createdAt.slice(0, 19)}</div>
                    {m.subject && <div>{m.subject}</div>}
                    <div className="meta">{m.body?.slice(0, 200)}</div>
                    {m.status === "failed" && m.error && (
                      <div className="error-banner" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                        {m.error}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel section">
            <h2>Notes</h2>
            <form onSubmit={(e) => void addNote(e)} className="stack-form">
              <div className="field">
                <label htmlFor="lead-note">Add a note</label>
                <textarea
                  id="lead-note"
                  rows={3}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Add a note…"
                />
              </div>
              <button type="submit" className="btn" disabled={addingNote}>
                Add note
              </button>
            </form>
            <ul className="note-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <p>{n.body}</p>
                  <div className="meta">
                    {n.createdAt.slice(0, 10)}{" "}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        void api.deleteLeadNote(n.id).then(() =>
                          setNotes((list) => list.filter((x) => x.id !== n.id))
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel section">
            <h2>Reminders</h2>
            <form onSubmit={(e) => void addReminder(e)} className="stack-form">
              <div className="field">
                <label htmlFor="lead-rem-date">Due date</label>
                <input
                  id="lead-rem-date"
                  type="date"
                  value={remForm.dueDate}
                  onChange={(e) => setRemForm({ ...remForm, dueDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="lead-rem-msg">Message</label>
                <input
                  id="lead-rem-msg"
                  value={remForm.message}
                  onChange={(e) => setRemForm({ ...remForm, message: e.target.value })}
                  placeholder="Reminder message"
                />
              </div>
              <button type="submit" className="btn" disabled={addingRem}>
                Add reminder
              </button>
            </form>
            <ul className="note-list">
              {reminders.map((r) => (
                <li key={r.id} className={r.completed ? undefined : "reminder-item"}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={r.completed}
                      onChange={(e) =>
                        void api.toggleLeadReminder(r.id, e.target.checked).then((updated) =>
                          setReminders((list) =>
                            list.map((x) => (x.id === r.id ? updated : x))
                          )
                        )
                      }
                    />
                    <span>
                      {r.dueDate} — {r.message}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
