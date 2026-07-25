import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type OutreachMessageListItem,
  type OutreachAnalytics,
} from "../../lib/api";

const STATUS_OPTIONS = ["queued", "sent", "delivered", "bounced", "complained", "failed"];

function statusChipClass(status: string): string {
  return `msg-status-chip status-${status}`;
}

export function OutreachSentPage() {
  const [messages, setMessages] = useState<OutreachMessageListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [analytics, setAnalytics] = useState<OutreachAnalytics | null>(null);

  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [variant, setVariant] = useState("");
  const [industry, setIndustry] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filterParams = useMemo(() => {
    const params: Record<string, string> = { limit: "50" };
    if (direction) params.direction = direction;
    if (status) params.status = status;
    if (templateId) params.templateId = templateId;
    if (variant) params.variant = variant;
    if (industry) params.industry = industry;
    if (q.trim()) params.q = q.trim();
    if (from) params.from = from;
    if (to) params.to = `${to}T23:59:59.999Z`;
    return params;
  }, [direction, status, templateId, variant, industry, q, from, to]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [page, an] = await Promise.all([
        api.listOutreachMessages(filterParams),
        api.getOutreachAnalytics(),
      ]);
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      setAnalytics(an);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [filterParams]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.listOutreachMessages({ ...filterParams, cursor: nextCursor });
      setMessages((prev) => [...prev, ...page.messages]);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!bodies[id]) {
      try {
        const full = await api.getOutreachMessage(id);
        setBodies((prev) => ({ ...prev, [id]: full.body ?? "" }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  const bounceN = analytics?.totals.bounced ?? 0;
  const complainN = analytics?.totals.complained ?? 0;

  return (
    <div className="page-enter">
      <div className="page-head">
        <h1>Sent log</h1>
        <span className="muted">{total} messages</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {(bounceN > 0 || complainN > 0) && (
        <div className="error-banner deliverability-banner" role="alert">
          Deliverability alert: {bounceN} bounce{bounceN === 1 ? "" : "s"}, {complainN} complaint
          {complainN === 1 ? "" : "s"}. On a new sending domain these matter more than reply rate.
        </div>
      )}

      <div className="filters panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <label>
            Direction
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">Any</option>
              <option value="out">Out</option>
              <option value="in">In</option>
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Template
            <input
              value={templateId}
              placeholder="initial / custom"
              onChange={(e) => setTemplateId(e.target.value)}
            />
          </label>
          <label>
            Variant
            <input value={variant} placeholder="A / B / C / D" onChange={(e) => setVariant(e.target.value)} />
          </label>
          <label>
            Industry
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Search
            <input
              value={q}
              placeholder="Business or subject"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <a className="btn btn-ghost" href={api.exportOutreachMessagesCsvUrl(filterParams)}>
            Export CSV
          </a>
        </div>
      </div>

      <div className="panel table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Business</th>
              <th>Dir</th>
              <th>Subject</th>
              <th>Variant</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <Fragment key={m.id}>
                <tr className={m.direction === "in" ? "msg-row-inbound" : undefined}>
                  <td className="meta">{m.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    <Link to={`/outreach/leads/${m.leadId}`}>{m.businessName}</Link>
                  </td>
                  <td>{m.direction}</td>
                  <td>{m.subject || <span className="muted">—</span>}</td>
                  <td>{m.variant || m.templateId || "—"}</td>
                  <td>
                    <span className={statusChipClass(m.status)}>{m.status}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void toggleExpand(m.id)}
                    >
                      {expandedId === m.id ? "Hide" : "Body"}
                    </button>
                  </td>
                </tr>
                {expandedId === m.id && (
                  <tr className={m.direction === "in" ? "msg-row-inbound" : undefined}>
                    <td colSpan={7}>
                      <pre className="audit-json" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                        {bodies[m.id] ?? m.bodyPreview ?? "Loading…"}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {messages.length === 0 && <p className="muted empty-pad">No messages match.</p>}
      </div>

      {nextCursor && (
        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
