import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatRate,
  rateIsSmallSample,
  SMALL_SAMPLE_THRESHOLD,
  TIME_TO_REPLY_MIN_N,
  type RateFraction,
} from "@shared/analyticsRates";
import { api, type LeadStats, type OutreachAnalytics } from "../../lib/api";
import { outreachStatusLabel } from "../../lib/mode";

function RateCell({ rate }: { rate: RateFraction }) {
  const small = rateIsSmallSample(rate.den);
  return (
    <span
      className={small ? "rate-small-sample" : undefined}
      title={small ? "too few sends to compare" : undefined}
    >
      {formatRate(rate)}
    </span>
  );
}

function BreakdownTable({
  title,
  rows,
  keyLabel,
  keyField,
}: {
  title: string;
  rows: Array<Record<string, string | number>>;
  keyLabel: string;
  keyField: string;
}) {
  return (
    <div className="panel" style={{ padding: "1.25rem" }}>
      <h2>{title}</h2>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        Sorted by volume. Rates under {SMALL_SAMPLE_THRESHOLD} sends show counts only.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>{keyLabel}</th>
            <th>Sent</th>
            <th>Replied</th>
            <th>Reply rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sent = Number(r.sent);
            const replied = Number(r.replied);
            const small = rateIsSmallSample(sent);
            return (
              <tr
                key={String(r[keyField])}
                className={small ? "rate-small-sample-row" : undefined}
                title={small ? "too few sends to compare" : undefined}
              >
                <td>{String(r[keyField])}</td>
                <td>{sent}</td>
                <td>{replied}</td>
                <td>
                  <RateCell rate={{ num: replied, den: sent }} />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No data yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function OutreachStatsPage() {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [analytics, setAnalytics] = useState<OutreachAnalytics | null>(null);
  const [dailyCap, setDailyCap] = useState(20);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, a, settings] = await Promise.all([
          api.getLeadStats(),
          api.getOutreachAnalytics(),
          api.getOutreachSettings(),
        ]);
        setStats(s);
        setAnalytics(a);
        setDailyCap(settings.dailySendCap);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!stats || !analytics) return <p className="muted page-enter">Loading stats…</p>;

  const statusData = Object.entries(stats.byStatus).map(([name, value]) => ({
    name: outreachStatusLabel(name),
    value,
  }));
  const funnelData = [
    { name: "Sourced", value: stats.funnel.sourced },
    { name: "Sent", value: stats.funnel.sent },
    { name: "Replied", value: stats.funnel.replied },
    { name: "Interested", value: stats.funnel.interested },
    { name: "Won", value: stats.funnel.won },
  ];

  return (
    <div className="page-enter">
      <div className="page-head">
        <h1>Outreach stats</h1>
      </div>

      <div className="tiles stagger">
        <div className="panel tile panel-lift">
          <div className="label">Total leads</div>
          <div className="value">{stats.total}</div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Delivery</div>
          <div className="value" style={{ fontSize: "1.25rem" }}>
            <RateCell rate={analytics.rates.delivery} />
          </div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Reply rate</div>
          <div className="value" style={{ fontSize: "1.25rem" }}>
            <RateCell rate={analytics.rates.reply} />
          </div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Positive reply</div>
          <div className="value" style={{ fontSize: "1.25rem" }}>
            <RateCell rate={analytics.rates.positive} />
          </div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Revenue (won)</div>
          <div className="value">£{analytics.totals.revenue.toLocaleString()}</div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Review queue</div>
          <div className="value">{stats.reviewQueue}</div>
        </div>
      </div>

      {(analytics.totals.bounced > 0 || analytics.totals.complained > 0) && (
        <div className="error-banner deliverability-banner" role="alert">
          {analytics.totals.bounced} bounce{analytics.totals.bounced === 1 ? "" : "s"},{" "}
          {analytics.totals.complained} complaint
          {analytics.totals.complained === 1 ? "" : "s"} recorded.
        </div>
      )}

      <div className="stats-charts">
        <div className="panel" style={{ padding: "1.25rem" }}>
          <h2>Funnel</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnelData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d5dde8" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#0f6e56" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel" style={{ padding: "1.25rem" }}>
          <h2>By status</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={statusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d5dde8" />
              <XAxis dataKey="name" hide />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#1a2332" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel" style={{ padding: "1.25rem", marginTop: "1rem" }}>
        <h2>Sends per day</h2>
        <p className="muted">Daily cap reference: {dailyCap}</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={analytics.sentPerDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d5dde8" />
            <XAxis dataKey="date" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <ReferenceLine y={dailyCap} stroke="#b45309" strokeDasharray="4 4" label="cap" />
            <Bar dataKey="sent" fill="#0f6e56" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {analytics.timeToReplyHours.n >= TIME_TO_REPLY_MIN_N && (
        <div className="panel" style={{ padding: "1.25rem", marginTop: "1rem" }}>
          <h2>Time to reply</h2>
          <p>
            Median{" "}
            <strong>
              {analytics.timeToReplyHours.median != null
                ? `${Math.round(analytics.timeToReplyHours.median * 10) / 10} hours`
                : "—"}
            </strong>{" "}
            <span className="muted">(n = {analytics.timeToReplyHours.n})</span>
          </p>
        </div>
      )}

      <div
        className="stats-charts"
        style={{ marginTop: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
      >
        <BreakdownTable
          title="By subject variant"
          keyLabel="Variant"
          keyField="variant"
          rows={analytics.bySubjectVariant}
        />
        <BreakdownTable
          title="By observation signal"
          keyLabel="Signal"
          keyField="signal"
          rows={analytics.bySignal}
        />
        <BreakdownTable
          title="By template"
          keyLabel="Template"
          keyField="templateId"
          rows={analytics.byTemplate}
        />
        <BreakdownTable
          title="By industry"
          keyLabel="Industry"
          keyField="industry"
          rows={analytics.byIndustry}
        />
      </div>
    </div>
  );
}
