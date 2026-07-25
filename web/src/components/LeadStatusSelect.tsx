import type { LeadStatus } from "@shared/outreach";
import { LEAD_STATUSES } from "@shared/outreach";
import { outreachStatusLabel } from "../lib/mode";

export function LeadStatusSelect({
  value,
  onChange,
  disabled,
  stopDrag,
}: {
  value: LeadStatus;
  onChange: (status: LeadStatus) => void | Promise<void>;
  disabled?: boolean;
  stopDrag?: boolean;
}) {
  return (
    <select
      className={`status-select lead-status ${value}`}
      value={value}
      disabled={disabled}
      aria-label="Lead status"
      onPointerDown={stopDrag ? (e) => e.stopPropagation() : undefined}
      onClick={stopDrag ? (e) => e.stopPropagation() : undefined}
      onChange={(e) => {
        const next = e.target.value as LeadStatus;
        if (next !== value) void onChange(next);
      }}
    >
      {LEAD_STATUSES.map((s) => (
        <option key={s} value={s}>
          {outreachStatusLabel(s)}
        </option>
      ))}
    </select>
  );
}
