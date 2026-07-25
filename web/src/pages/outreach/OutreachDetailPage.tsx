import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Lead, LeadStatus } from "@shared/outreach";
import { api, type LeadMessage, type LeadNote, type LeadReminder } from "../../lib/api";
import { LeadStatusSelect } from "../../components/LeadStatusSelect";

export function OutreachDetailPage() {
  const { id } = useParams();
  const leadId = Number(id);
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [reminders, setReminders] = useState<LeadReminder[]>([]);
  const [messages, setMessages] = useState<LeadMessage[]>([]);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [leadId]);

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
      setFlash("Saved.");
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
      setFlash(JSON.stringify(res));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  if (!lead && !error) return <p className="muted page-enter">Loading…</p>;
  if (!lead) return <div className="error-banner">{error}</div>;

  return (
    <div className="page-enter detail-page">
      <div className="page-head">
        <div>
          <Link to="/outreach" className="muted">
            ← Board
          </Link>
          <h1>{lead.businessName}</h1>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <LeadStatusSelect
            value={lead.status}
            disabled={statusSaving}
            onChange={(s) => void saveStatus(s)}
          />
          <button
            type="button"
            className="btn"
            disabled={actionBusy}
            onClick={() => void runSend(true)}
          >
            Approve & send
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={actionBusy}
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

      {error && <div className="error-banner">{error}</div>}
      {flash && <div className="success-banner">{flash}</div>}

      {lead.reviewReasons.length > 0 && (
        <div className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <strong>Review reasons</strong>
          <ul className="reason-list">
            {lead.reviewReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="detail-grid">
        <form className="panel form-grid" style={{ padding: "1.25rem" }} onSubmit={(e) => void save(e)}>
          <h2>Lead</h2>
          <label>
            Business name
            <input
              value={lead.businessName}
              onChange={(e) => setLead({ ...lead, businessName: e.target.value })}
            />
          </label>
          <label>
            Industry
            <input
              value={lead.industry ?? ""}
              onChange={(e) => setLead({ ...lead, industry: e.target.value || null })}
            />
          </label>
          <label>
            Location
            <input
              value={lead.location ?? ""}
              onChange={(e) => setLead({ ...lead, location: e.target.value || null })}
            />
          </label>
          <label>
            Postcode
            <input
              value={lead.postcode ?? ""}
              onChange={(e) => setLead({ ...lead, postcode: e.target.value || null })}
            />
          </label>
          <label>
            Contact name
            <input
              value={lead.contactName ?? ""}
              onChange={(e) => setLead({ ...lead, contactName: e.target.value || null })}
            />
          </label>
          <label>
            Contact email
            <input
              value={lead.contactEmail ?? ""}
              onChange={(e) => setLead({ ...lead, contactEmail: e.target.value || null })}
            />
          </label>
          <label>
            Phone
            <input
              value={lead.contactPhone ?? ""}
              onChange={(e) => setLead({ ...lead, contactPhone: e.target.value || null })}
            />
          </label>
          <label>
            Website
            <input
              value={lead.websiteUrl ?? ""}
              onChange={(e) => setLead({ ...lead, websiteUrl: e.target.value || null })}
            />
          </label>
          <label>
            Demo URL
            <input
              value={lead.demoUrl ?? ""}
              onChange={(e) => setLead({ ...lead, demoUrl: e.target.value || null })}
            />
          </label>
          <label>
            Need score
            <input
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
          </label>
          <label>
            Likelihood
            <input
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
          </label>
          <label>
            Priority
            <input
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
          </label>
          <label>
            Score reason
            <textarea
              rows={2}
              value={lead.scoreReason ?? ""}
              onChange={(e) => setLead({ ...lead, scoreReason: e.target.value || null })}
            />
          </label>
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
          <label>
            Offer amount
            <input
              type="number"
              value={lead.offerAmount}
              onChange={(e) => setLead({ ...lead, offerAmount: Number(e.target.value) || 0 })}
            />
          </label>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>

        <div className="detail-side">
          <section className="panel" style={{ padding: "1.25rem" }}>
            <h2>Scores & audit</h2>
            <p className="meta">
              Demo: {lead.demoStatus}
              {lead.demoUrl ? (
                <>
                  {" · "}
                  <a href={lead.demoUrl} target="_blank" rel="noreferrer">
                    open
                  </a>
                </>
              ) : null}
            </p>
            <p className="meta">
              Sent {lead.sentAt?.slice(0, 10) ?? "—"} · Reply{" "}
              {lead.repliedAt?.slice(0, 10) ?? "—"} ({lead.replySentiment ?? "n/a"})
            </p>
            <pre className="audit-json">{JSON.stringify(lead.audit, null, 2)}</pre>
          </section>

          <section className="panel" style={{ padding: "1.25rem" }}>
            <h2>Message thread</h2>
            {messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : (
              <ul className="thread-list">
                {messages.map((m) => (
                  <li key={m.id}>
                    <strong>
                      {m.direction} · {m.status}
                    </strong>
                    <div className="meta">{m.createdAt.slice(0, 19)}</div>
                    {m.subject && <div>{m.subject}</div>}
                    <div className="meta">{m.body?.slice(0, 200)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" style={{ padding: "1.25rem" }}>
            <h2>Notes</h2>
            <form onSubmit={(e) => void addNote(e)} className="stack-form">
              <textarea
                rows={3}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add a note…"
              />
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

          <section className="panel" style={{ padding: "1.25rem" }}>
            <h2>Reminders</h2>
            <form onSubmit={(e) => void addReminder(e)} className="stack-form">
              <input
                type="date"
                value={remForm.dueDate}
                onChange={(e) => setRemForm({ ...remForm, dueDate: e.target.value })}
              />
              <input
                value={remForm.message}
                onChange={(e) => setRemForm({ ...remForm, message: e.target.value })}
                placeholder="Reminder message"
              />
              <button type="submit" className="btn" disabled={addingRem}>
                Add reminder
              </button>
            </form>
            <ul className="note-list">
              {reminders.map((r) => (
                <li key={r.id}>
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
