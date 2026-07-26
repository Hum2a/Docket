import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Lead, LeadStatus } from "@shared/outreach";
import { slugifyName } from "@shared/outreach";
import { api } from "../../lib/api";
import { Modal } from "../../components/Modal";
import { LeadStatusSelect } from "../../components/LeadStatusSelect";
import { ContactRouteChip } from "../../components/ContactRouteChip";
import { outreachStatusLabel } from "../../lib/mode";

/** Visible board columns (canonical drop status). */
const BOARD_COLUMNS: LeadStatus[] = [
  "scored",
  "queued",
  "demo_ready",
  "sent",
  "replied",
  "won",
  "lost",
];

const PIPELINE_STATUSES: LeadStatus[] = ["sourced", "qualified", "audited"];

const BADGE_STATUSES: LeadStatus[] = ["interested", "not_interested", "unsubscribed", "followed_up"];

function boardBucket(status: LeadStatus): LeadStatus | "pipeline" | null {
  if (PIPELINE_STATUSES.includes(status)) return "pipeline";
  if (status === "followed_up") return "sent";
  if (status === "interested" || status === "not_interested" || status === "unsubscribed") {
    return "replied";
  }
  if (BOARD_COLUMNS.includes(status)) return status;
  return null;
}

function Card({
  lead,
  busy,
  onDelete,
  onStatusChange,
}: {
  lead: Lead;
  busy?: boolean;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: LeadStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(lead.id),
    data: { lead },
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`card ${isDragging ? "dragging" : ""}`}
      {...listeners}
      {...attributes}
    >
      <h3>{lead.businessName}</h3>
      <div style={{ marginBottom: "0.35rem" }}>
        <ContactRouteChip route={lead.contactRoute} />
      </div>
      <p className="meta">{lead.industry || "—"}</p>
      <p className="meta">{lead.location || lead.postcode || ""}</p>
      {lead.priorityScore != null && (
        <p className="meta">Priority {lead.priorityScore.toFixed(1)}</p>
      )}
      {BADGE_STATUSES.includes(lead.status) && (
        <span className="badge badge-status">{outreachStatusLabel(lead.status)}</span>
      )}
      <LeadStatusSelect
        value={lead.status}
        disabled={busy}
        stopDrag
        onChange={(status) => onStatusChange(lead.id, status)}
      />
      <div className="card-actions">
        <div>
          {lead.reviewReasons.length > 0 && (
            <span className="badge badge-due">Review</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <Link
            to={`/outreach/leads/${lead.id}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            Open
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onDelete(lead.id)}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function Column({
  status,
  leads,
  busyId,
  onDelete,
  onStatusChange,
}: {
  status: LeadStatus;
  leads: Lead[];
  busyId: number | null;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: LeadStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`column ${status}`}
      style={{ outline: isOver ? "2px solid var(--accent)" : undefined }}
    >
      <div className="column-head">
        <h2>{outreachStatusLabel(status)}</h2>
        <span className="column-count">{leads.length}</span>
      </div>
      {leads.length === 0 ? (
        <div className="empty">No leads</div>
      ) : (
        leads.map((l) => (
          <Card
            key={l.id}
            lead={l}
            busy={busyId === l.id}
            onDelete={onDelete}
            onStatusChange={onStatusChange}
          />
        ))
      )}
    </section>
  );
}

export function OutreachBoardPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState({
    businessName: "",
    industry: "",
    location: "",
    contactEmail: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listLeads({ limit: "200" });
      setLeads(page.leads);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pipelineCount = useMemo(
    () => leads.filter((l) => PIPELINE_STATUSES.includes(l.status)).length,
    [leads]
  );

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(BOARD_COLUMNS.map((s) => [s, [] as Lead[]])) as Record<
      LeadStatus,
      Lead[]
    >;
    for (const l of leads) {
      const bucket = boardBucket(l.status);
      if (bucket && bucket !== "pipeline" && map[bucket]) map[bucket].push(l);
    }
    return map;
  }, [leads]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const activeLead = activeId ? leads.find((l) => String(l.id) === activeId) : null;

  async function onDelete(id: number) {
    if (!confirm("Delete this lead? This cannot be undone.")) return;
    const prev = leads;
    setLeads((a) => a.filter((x) => x.id !== id));
    try {
      await api.deleteLead(id);
    } catch (e) {
      setLeads(prev);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onStatusChange(id: number, status: LeadStatus) {
    const lead = leads.find((a) => a.id === id);
    if (!lead || lead.status === status) return;
    const prev = leads;
    setBusyId(id);
    setLeads((list) => list.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      await api.updateLead(id, { status });
    } catch (err) {
      setLeads(prev);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const overId = e.over?.id;
    if (!overId) return;
    const status = String(overId) as LeadStatus;
    if (!BOARD_COLUMNS.includes(status)) return;
    const id = Number(e.active.id);
    await onStatusChange(id, status);
  }

  async function onCreate(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form.businessName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.createLead({
        businessName: form.businessName.trim(),
        slug: slugifyName(form.businessName),
        industry: form.industry || null,
        location: form.location || null,
        contactEmail: form.contactEmail || null,
      });
      setLeads((list) => [created, ...list]);
      setShowCreate(false);
      setForm({ businessName: "", industry: "", location: "", contactEmail: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-enter">
      <div className="page-head">
        <h1>Outreach board</h1>
        <button type="button" className="btn" onClick={() => setShowCreate(true)}>
          Add lead
        </button>
      </div>

      {!loading && (
        <p className="muted pipeline-counter">
          <Link to="/outreach/list?pipeline=1">In pipeline ({pipelineCount})</Link>
          <span> — sourced, qualified, audited</span>
        </p>
      )}

      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading leads…</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <div className="board board-wide">
            {BOARD_COLUMNS.map((status) => (
              <Column
                key={status}
                status={status}
                leads={byColumn[status]}
                busyId={busyId}
                onDelete={onDelete}
                onStatusChange={onStatusChange}
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? (
              <article className="card dragging">
                <h3>{activeLead.businessName}</h3>
              </article>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="New lead">
          <form onSubmit={(e) => void onCreate(e)} className="form-grid">
            <label>
              Business name
              <input
                required
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              />
            </label>
            <label>
              Industry
              <input
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </label>
            <label>
              Location
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </label>
            <label>
              Contact email
              <input
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Saving…" : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
