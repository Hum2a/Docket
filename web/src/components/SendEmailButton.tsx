import { useCallback, useEffect, useState } from "react";
import type { Lead } from "@shared/outreach";
import { api } from "../lib/api";

type Readiness = {
  ok: boolean;
  labels: string[];
  blocking: string[];
  dryRun: boolean;
  preflightReady: boolean;
};

type Preview = {
  subject: string;
  text: string;
};

export function SendEmailButton({
  lead,
  onDone,
}: {
  lead: Lead;
  onDone?: () => void;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReadiness = useCallback(async () => {
    try {
      const r = await api.getSendReadiness(lead.id);
      setReadiness(r);
    } catch (e) {
      setReadiness({
        ok: false,
        labels: [e instanceof Error ? e.message : String(e)],
        blocking: [],
        dryRun: false,
        preflightReady: false,
      });
    }
  }, [lead.id]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness, lead.status, lead.contactEmail, lead.demoStatus, lead.emailVerified]);

  const enabled = readiness?.ok === true;
  const dryRun = readiness?.dryRun === true;
  const tooltip =
    !enabled && readiness
      ? readiness.blocking.length
        ? readiness.blocking.join("; ")
        : readiness.labels.join("; ")
      : undefined;

  const alreadySent =
    lead.followupStep > 0 ||
    ["sent", "followed_up", "replied", "interested", "won", "lost"].includes(lead.status);

  async function openModal() {
    setError(null);
    setBusy(true);
    try {
      const p = await api.getOutreachPreview(lead.id);
      setPreview({ subject: p.subject, text: p.text });
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.sendLead(lead.id, { manual: true });
      if (!res.sent && !res.dryRun) {
        setError((res.reasons || []).join(", ") || res.error || "Send failed");
        return;
      }
      setOpen(false);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = dryRun
    ? "Send (dry run)"
    : alreadySent
      ? "Send follow-up"
      : "Send email";

  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={!enabled || busy}
        title={tooltip}
        onClick={() => void openModal()}
      >
        {label}
      </button>
      {error && !open && <div className="error-banner" style={{ marginTop: "0.5rem" }}>{error}</div>}

      {open && preview && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="send-modal-title">{dryRun ? "Queue dry-run email" : "Send email"}</h2>
            <p>
              To: <strong>{lead.contactEmail}</strong>
            </p>
            <p className="meta">Subject: {preview.subject}</p>
            <pre className="audit-json" style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>
              {preview.text}
            </pre>
            {error && <div className="error-banner">{error}</div>}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="button" className="btn" disabled={busy} onClick={() => void confirmSend()}>
                {busy ? "Sending…" : dryRun ? "Queue dry run" : "Confirm send"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
