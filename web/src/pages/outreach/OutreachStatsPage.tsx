import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type LeadStats } from "../../lib/api";
import { outreachStatusLabel } from "../../lib/mode";

export function OutreachStatsPage() {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setStats(await api.getLeadStats());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!stats) return <p className="muted page-enter">Loading stats…</p>;

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
          <div className="label">Reply rate</div>
          <div className="value">{stats.replyRate}%</div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Positive reply</div>
          <div className="value">{stats.positiveReplyRate}%</div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Revenue (won)</div>
          <div className="value">£{stats.revenue.toLocaleString()}</div>
        </div>
        <div className="panel tile panel-lift">
          <div className="label">Review queue</div>
          <div className="value">{stats.reviewQueue}</div>
        </div>
      </div>

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
    </div>
  );
}
