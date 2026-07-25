import { useCallback, useEffect, useState } from "react";
import { api, type OutreachSettingsView, type PreflightCheckKey } from "../../lib/api";
import {
  PREFLIGHT_HINTS,
  PREFLIGHT_LABELS,
  useOutreachPreflight,
} from "../../lib/useOutreachPreflight";

const CHECK_ORDER: PreflightCheckKey[] = [
  "sending_domain_set",
  "from_address_set",
  "from_domain_not_primary",
  "postal_address_set",
  "unsubscribe_key_set",
  "resend_key_set",
  "reply_to_set",
];

export function OutreachSettingsPage() {
  const [settings, setSettings] = useState<OutreachSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suppressValue, setSuppressValue] = useState("");
  const [suppressKind, setSuppressKind] = useState<"email" | "domain">("email");
  const [bulkText, setBulkText] = useState("");
  const { preflight, reload: reloadPreflight } = useOutreachPreflight();

  const load = useCallback(async () => {
    setError(null);
    try {
      setSettings(await api.getOutreachSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.updateOutreachSettings(patch);
      setSettings(next);
      setMessage("Settings saved.");
      await reloadPreflight();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSuppress(e: React.FormEvent) {
    e.preventDefault();
    if (!suppressValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addSuppression(suppressValue.trim(), suppressKind);
      setMessage(`Suppressed ${suppressKind}: ${suppressValue.trim()}`);
      setSuppressValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onBulk(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(bulkText) as { leads?: unknown } | unknown[];
      const leads = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { leads?: unknown }).leads)
          ? (parsed as { leads: unknown[] }).leads
          : null;
      if (!leads) throw new Error("JSON must be an array or { leads: [...] }");
      const result = await api.bulkLeads(leads as Parameters<typeof api.bulkLeads>[0]);
      setMessage(
        `Bulk upsert: ${result.created.length} created, ${result.updated.length} updated, ${result.skipped} skipped.`
      );
      setBulkText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!settings && !error) return <p className="muted page-enter">Loading…</p>;

  const ready = preflight?.ready === true;
  const autoSendBlockedTitle = ready
    ? undefined
    : (preflight?.blocking.map((k) => PREFLIGHT_HINTS[k]).join(" ") ??
      "Outreach is not configured yet.");

  return (
    <div className="page-enter">
      <div className="page-head">
        <h1>Outreach settings</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      {preflight && (
        <section className="panel preflight-panel" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
          <h2>Send readiness</h2>
          <p className="muted">
            {ready
              ? preflight.warnings.length > 0
                ? "Ready to send, with warnings."
                : "All required checks passed."
              : "Fix the items below before enabling auto-send or approving live sends."}
          </p>
          <ul className="preflight-list">
            {CHECK_ORDER.map((key) => {
              const ok = preflight.checks[key];
              const warning = preflight.warnings.includes(key);
              const advisory = key === "reply_to_set" || warning;
              return (
                <li key={key} className={ok ? "ok" : advisory ? "warn" : "fail"}>
                  <span className="preflight-mark" aria-hidden>
                    {ok ? "✓" : warning ? "!" : "✗"}
                  </span>
                  <div>
                    <strong>{PREFLIGHT_LABELS[key]}</strong>
                    {!ok && <p className="meta">{PREFLIGHT_HINTS[key]}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {settings && (
        <div className="settings-stack">
          <section className="panel" style={{ padding: "1.25rem" }}>
            <h2>Sending controls</h2>
            <p className="muted">
              Sent today: {settings.sentToday} / {settings.dailySendCap}
            </p>
            <div className="form-grid" style={{ marginTop: "1rem" }}>
              <label
                className="checkbox-row"
                title={autoSendBlockedTitle}
              >
                <input
                  type="checkbox"
                  checked={settings.autoSendEnabled}
                  disabled={busy || !ready}
                  onChange={(e) => void save({ autoSendEnabled: e.target.checked })}
                />
                Auto-send enabled
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.dryRun}
                  disabled={busy}
                  onChange={(e) => void save({ dryRun: e.target.checked })}
                />
                Dry run (queue messages, no Resend)
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.allowPrimarySendingDomain}
                  disabled={busy}
                  onChange={(e) =>
                    void save({ allowPrimarySendingDomain: e.target.checked })
                  }
                />
                Allow sending from humza-butt.space
              </label>
              <p className="meta" style={{ marginTop: "-0.5rem", marginBottom: "0.5rem" }}>
                Cold outreach from this domain can affect delivery of everything else sent from it,
                including Docket&apos;s own job digests.
              </p>
              <label>
                Sending domain
                <input
                  defaultValue={settings.sendingDomain ?? ""}
                  disabled={busy}
                  placeholder="mail.your-outreach-domain.com"
                  onBlur={(e) =>
                    void save({ sendingDomain: e.target.value.trim() || null })
                  }
                />
              </label>
              <label>
                From address
                <input
                  defaultValue={settings.fromAddress ?? ""}
                  disabled={busy}
                  placeholder="Outreach <hello@mail.your-outreach-domain.com>"
                  onBlur={(e) =>
                    void save({ fromAddress: e.target.value.trim() || null })
                  }
                />
              </label>
              <label>
                Reply-to
                <input
                  defaultValue={settings.replyTo ?? ""}
                  disabled={busy}
                  placeholder="hello@mail.your-outreach-domain.com"
                  onBlur={(e) => void save({ replyTo: e.target.value.trim() || null })}
                />
              </label>
              <label>
                Postal address
                <input
                  defaultValue={settings.postalAddress ?? ""}
                  disabled={busy}
                  placeholder="Your name, street, city, postcode"
                  onBlur={(e) =>
                    void save({ postalAddress: e.target.value.trim() || null })
                  }
                />
              </label>
              <label>
                Auto-send threshold
                <input
                  type="number"
                  step="0.1"
                  defaultValue={settings.autoSendThreshold}
                  disabled={busy}
                  onBlur={(e) => void save({ autoSendThreshold: Number(e.target.value) })}
                />
              </label>
              <label>
                Daily send cap
                <input
                  type="number"
                  defaultValue={settings.dailySendCap}
                  disabled={busy}
                  onBlur={(e) => void save({ dailySendCap: Number(e.target.value) })}
                />
              </label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void save({ pause: true })}
                >
                  Pause 24h
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void save({ pause: false })}
                >
                  Clear pause
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || !ready}
                  title={autoSendBlockedTitle}
                  onClick={() =>
                    void api.runAutosend().then((r) => setMessage(`Autosend: ${JSON.stringify(r)}`))
                  }
                >
                  Run autosend
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || !ready}
                  title={autoSendBlockedTitle}
                  onClick={() =>
                    void api.runSequence().then((r) => setMessage(`Sequence: ${JSON.stringify(r)}`))
                  }
                >
                  Run sequence
                </button>
              </div>
              {settings.pausedUntil && (
                <p className="meta">Paused until {settings.pausedUntil}</p>
              )}
            </div>
          </section>

          <section className="panel" style={{ padding: "1.25rem" }}>
            <h2>Suppressions</h2>
            <form onSubmit={(e) => void onSuppress(e)} className="toolbar">
              <select
                value={suppressKind}
                onChange={(e) => setSuppressKind(e.target.value as "email" | "domain")}
              >
                <option value="email">Email</option>
                <option value="domain">Domain</option>
              </select>
              <input
                value={suppressValue}
                onChange={(e) => setSuppressValue(e.target.value)}
                placeholder={suppressKind === "email" ? "name@company.com" : "company.com"}
                style={{ minWidth: 220 }}
              />
              <button type="submit" className="btn" disabled={busy}>
                Suppress
              </button>
            </form>
          </section>

          <section className="panel" style={{ padding: "1.25rem" }}>
            <h2>Bulk upsert</h2>
            <p className="muted">
              Paste JSON array of leads (or {"{"} leads: [...] {"}"}). Upserts on source_ref then
              business+postcode; send history is preserved.
            </p>
            <form onSubmit={(e) => void onBulk(e)} className="stack-form">
              <textarea
                rows={10}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder='[{"businessName":"Acme Ltd","slug":"acme-ltd","postcode":"SW1A 1AA"}]'
              />
              <button type="submit" className="btn" disabled={busy}>
                Upsert leads
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
