import type { ContactRoute } from "@shared/contactRoute";
import { CONTACT_ROUTE_META } from "@shared/contactRoute";

export function ContactRouteChip({ route }: { route: ContactRoute }) {
  const meta = CONTACT_ROUTE_META[route];
  return (
    <span className={meta.className} title={meta.title}>
      {meta.label}
    </span>
  );
}
