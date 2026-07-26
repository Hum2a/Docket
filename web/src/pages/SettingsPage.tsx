import { useCallback, useEffect, useState } from "react";
import type { Document, DocumentType } from "@shared/schema";
import { api, clearApiKey, getApiKey, setApiKey } from "../lib/api";

export function SettingsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<DocumentType>("resume");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const [testEmailBusy, setTestEmailBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [notifyTo, setNotifyTo] = useState("");
  const [fromAddress, setFromAddress] = useState("Docket <Docket@Humza-Butt.space>");
  const [effectiveNotifyTo, setEffectiveNotifyTo] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(() => Boolean(getApiKey()));

  const load = useCallback(async () => {
    setError(null);
    try {
      const [documentList, settings] = await Promise.all([
        api.listDocuments(null),
        api.getSettings(),
      ]);
      setDocs(documentList);
      setNotifyTo(
        settings.notifyTo || settings.effectiveNotifyTo.join(", ")
      );
      setEffectiveNotifyTo(settings.effectiveNotifyTo);
      setFromAddress(settings.from);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const doc = await api.uploadDocument(file, docType, null);
      setDocs((list) => [doc, ...list]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removeDoc(id: number) {
    try {
      await api.deleteDocument(id);
      setDocs((list) => list.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const payload = JSON.parse(importText) as unknown;
      const result = await api.importApplications(payload);
      setMessage(`Imported ${result.inserted.length} application(s).`);
      setImportText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  async function onSaveNotify(e: React.FormEvent) {
    e.preventDefault();
    setSettingsBusy(true);
    setError(null);
    setMessage(null);
    try {
      const settings = await api.updateSettings(notifyTo);
      setNotifyTo(settings.notifyTo);
      setEffectiveNotifyTo(settings.effectiveNotifyTo);
      setFromAddress(settings.from);
      setMessage(
        settings.effectiveNotifyTo.length > 0
          ? `Saved. Emails go to: ${settings.effectiveNotifyTo.join(", ")}`
          : "Saved. No recipients yet — add at least one email."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function onDigest() {
    setDigestBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.runDigest();
      setMessage(
        result.sent
          ? `Digest sent (${result.count} reminder(s)).`
          : `Digest skipped: ${result.reason ?? "unknown"}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDigestBusy(false);
    }
  }

  async function onTestEmail() {
    setTestEmailBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.sendTestEmail();
      setMessage(
        result.sent
          ? "Test email sent. Check your inbox."
          : `Test email skipped: ${result.reason ?? "unknown"}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestEmailBusy(false);
    }
  }

  return (
    <div className="page-enter">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && (
        <div className="panel section" style={{ marginBottom: "1rem", color: "var(--accent)" }}>
          {message}
        </div>
      )}

      <div className="detail-grid">
        <section className="panel section">
          <h2>Global templates</h2>
          <p className="muted">
            Resume and cover letter templates not tied to a specific application.
          </p>
          {docs.map((d) => (
            <div key={d.id} className="doc-item">
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <span>
                  <strong>{d.filename}</strong>
                  <span className="muted"> · {d.type.replace("_", " ")}</span>
                </span>
                <span style={{ display: "flex", gap: "0.35rem" }}>
                  <button type="button" className="btn" onClick={() => api.downloadDocument(d.id)}>
                    Download
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => removeDoc(d.id)}>
                    Delete
                  </button>
                </span>
              </div>
            </div>
          ))}
          {docs.length === 0 && <p className="empty">No templates yet.</p>}
          <div className="form-grid" style={{ marginTop: "0.75rem" }}>
            <div className="field">
              <label>Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocumentType)}
              >
                <option value="resume">Resume</option>
                <option value="cover_letter">Cover letter</option>
              </select>
            </div>
            <div className="field">
              <label>Upload</label>
              <input type="file" onChange={onUpload} disabled={uploading} />
            </div>
          </div>
          {uploading && <p className="muted">Uploading…</p>}
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <section className="panel section">
            <h2>Bulk import</h2>
            <p className="muted">
              Paste JSON with an <code>applications</code> array (optional nested notes/reminders).
            </p>
            <form onSubmit={onImport}>
              <div className="field">
                <label>JSON</label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  style={{ minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}
                  placeholder={`{\n  "applications": [{ "company": "", "roleTitle": "", "industry": "" }]\n}`}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ marginTop: "0.6rem" }}
                disabled={importing || !importText.trim()}
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </form>
          </section>

          <section className="panel section">
            <h2>API key</h2>
            <p className="muted">
              Outreach data (leads, messages, exports) requires the Docket API key. It is stored
              only in this browser&apos;s localStorage and sent as an <code>X-Api-Key</code> header —
              never in the URL.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = apiKeyDraft.trim();
                if (!trimmed) {
                  clearApiKey();
                  setApiKeyDraft("");
                  setHasStoredKey(false);
                  setMessage("API key cleared.");
                  return;
                }
                setApiKey(trimmed);
                setApiKeyDraft("");
                setHasStoredKey(true);
                setMessage("API key saved in this browser.");
              }}
              style={{ marginTop: "0.75rem" }}
            >
              <div className="field">
                <label htmlFor="apiKey">
                  {hasStoredKey ? "Replace API key" : "Enter API key"}
                </label>
                <input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder={hasStoredKey ? "•••••••• (saved)" : "Paste API key"}
                  style={{ width: "100%", maxWidth: 420 }}
                />
                <span className="muted">
                  {hasStoredKey
                    ? "A key is saved for this browser."
                    : "No key saved — board and list will ask you to enter one."}
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
                <button type="submit" className="btn btn-primary">
                  {apiKeyDraft.trim() ? "Save API key" : hasStoredKey ? "Clear API key" : "Save API key"}
                </button>
                {hasStoredKey && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      clearApiKey();
                      setApiKeyDraft("");
                      setHasStoredKey(false);
                      setMessage("API key cleared.");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="panel section">
            <h2>Email</h2>
            <p className="muted">
              Create + status alerts and the daily digest share these recipients. From address is{" "}
              <strong>{fromAddress}</strong>.
            </p>

            <form onSubmit={onSaveNotify} style={{ marginTop: "0.75rem" }}>
              <div className="field">
                <label htmlFor="notifyTo">Notify emails</label>
                <textarea
                  id="notifyTo"
                  value={notifyTo}
                  onChange={(e) => setNotifyTo(e.target.value)}
                  placeholder="you@example.com, other@example.com"
                  style={{ minHeight: 72 }}
                />
                <span className="muted">
                  Comma or newline separated. Active:{" "}
                  {effectiveNotifyTo.length > 0 ? effectiveNotifyTo.join(", ") : "none"}
                </span>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ marginTop: "0.6rem" }}
                disabled={settingsBusy}
              >
                {settingsBusy ? "Saving…" : "Save recipients"}
              </button>
            </form>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={testEmailBusy}
                onClick={onTestEmail}
              >
                {testEmailBusy ? "Sending…" : "Send test email"}
              </button>
              <button type="button" className="btn" disabled={digestBusy} onClick={onDigest}>
                {digestBusy ? "Running…" : "Run digest now"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
