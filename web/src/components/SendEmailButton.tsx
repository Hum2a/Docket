import { useCallback, useEffect, useState } from "react";
import type { Lead } from "@shared/outreach";
import { api } from "../lib/api";

type Readiness = {
  ok: boolean;
  labels: string[];
  blocking: string[];
  reasons: string[];
  warnings: string[];
  warningLabels: string[];
  dryRun: boolean;
  preflightReady: boolean;
};

type Preview = {
  subject: string;
  text: string;
};

function hasConsent(lead: Lead): boolean {
  return Boolean(lead.consentStatus && lead.consentStatus !== "none");
}

export function SendEmailButton({
  lead,
  onDone,
  buttonLabel,
  className = "btn",
}: {
  lead: Lead;
  onDone?: () => void;
  /** Override the default Send email / Send follow-up label (e.g. Retry send). */
  buttonLabel?: string;
  /** Extra button classes (e.g. `btn btn-primary` on lead detail). */
  className?: string;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const warm = hasConsent(lead);
  const lane = warm ? ("warm" as const) : undefined;

  const loadReadiness = useCallback(async () => {
    try {
      const r = await api.getSendReadiness(lead.id, lane ? { lane } : undefined);
      setReadiness({
        ok: r.ok,
        labels: r.labels,
        blocking: r.blocking,
        reasons: r.reasons ?? [],
        warnings: r.warnings ?? [],
        warningLabels: r.warningLabels ?? (r.warnings ?? []).map((code) => code),
        dryRun: r.dryRun,
        preflightReady: r.preflightReady,
      });
    } catch (e) {
      setReadiness({
        ok: false,
        labels: [e instanceof Error ? e.message : String(e)],
        blocking: [],
        reasons: [],
        warnings: [],
        warningLabels: [],
        dryRun: false,
        preflightReady: false,
      });
    }
  }, [lead.id, lane]);

  useEffect(() => {
    void loadReadiness();
  }, [
    loadReadiness,
    lead.status,
    lead.contactEmail,
    lead.demoStatus,
    lead.emailVerified,
    lead.businessName,
    lead.industry,
    lead.consentStatus,
    lead.customSubject,
    lead.customBody,
  ]);

  const dryRun = readiness?.dryRun === true;
  const blockLabels =
    readiness?.blocking?.length ? readiness.blocking : readiness?.labels ?? [];
  const warningLabels = readiness?.warningLabels ?? [];
  const warnings = readiness?.warnings ?? [];
  const hasBlockers = (readiness?.reasons.length ?? 0) > 0 || readiness?.preflightReady === false;
  const needsAck = warnings.length > 0;
  const canConfirm = !hasBlockers && (!needsAck || checked);
  const tooltip = hasBlockers
    ? blockLabels.length
      ? blockLabels.join("; ")
      : "Not ready to send"
    : needsAck && !checked
      ? "Tick I've checked this to send with warnings"
      : undefined;

  const alreadySent =
    lead.followupStep > 0 ||
    ["sent", "followed_up", "replied", "interested", "won", "lost"].includes(lead.status);

  async function openModal() {
    setError(null);
    setChecked(false);
    setBusy(true);
    try {
      await loadReadiness();
      const p = await api.getOutreachPreview(lead.id, lane ? { lane } : undefined);
      setPreview({ subject: p.subject, text: p.text });
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.sendLead(lead.id, {
        manual: true,
        warm,
        acknowledgedWarnings: needsAck ? warnings : [],
      });
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

  const label =
    buttonLabel ??
    (dryRun
      ? warm
        ? "Send warm (dry run)"
        : "Send (dry run)"
      : alreadySent
        ? "Send follow-up"
        : warm
          ? "Send warm email"
          : "Send email");

  const toAddress = warm ? lead.consentEmail : lead.contactEmail;

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        title={tooltip}
        onClick={() => void openModal()}
      >
        {label}
      </button>
      {error && !open && (
        <div className="error-banner" style={{ marginTop: "0.5rem" }}>
          {error}
        </div>
      )}

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
              To: <strong>{toAddress || "—"}</strong>
              {warm ? " (warm lane)" : null}
            </p>
            <p>
              <strong>Subject:</strong> {preview.subject}
            </p>
            <pre className="audit-json" style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>
              {preview.text}
            </pre>
            {hasBlockers && blockLabels.length > 0 && (
              <div className="error-banner" style={{ marginTop: "0.75rem" }}>
                <p style={{ margin: "0 0 0.35rem" }}>Cannot send — fix these first:</p>
                <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  {blockLabels.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            )}
            {!hasBlockers && warningLabels.length > 0 && (
              <div className="gate-warnings" role="status">
                <p style={{ margin: "0 0 0.35rem" }}>Check these before sending:</p>
                <ul style={{ margin: "0 0 0.65rem", paddingLeft: "1.2rem" }}>
                  {warningLabels.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  I've checked this
                </label>
              </div>
            )}
            {error && <div className="error-banner">{error}</div>}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn"
                disabled={busy || !canConfirm}
                title={!canConfirm ? tooltip : undefined}
                onClick={() => void confirmSend()}
              >
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
