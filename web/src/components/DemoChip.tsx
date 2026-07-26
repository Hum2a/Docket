import { resolveDemoChip, type DemoChipInput } from "@shared/demoStatus";

export function DemoChip(props: DemoChipInput) {
  const view = resolveDemoChip(props);
  if (view.href) {
    return (
      <a
        className={view.className}
        href={view.href}
        target="_blank"
        rel="noreferrer"
        title={view.label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {view.label}
      </a>
    );
  }
  return (
    <span className={view.className} title={view.label}>
      {view.label}
    </span>
  );
}
