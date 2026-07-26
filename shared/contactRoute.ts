import { isFreemail } from "./freemail";

export type ContactRoute = "email" | "freemail" | "phone" | "form" | "none";

export type ContactRouteInput = {
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactFormUrl?: string | null;
};

/** Computed contact route — never stored; derive from lead fields. */
export function contactRoute(lead: ContactRouteInput): ContactRoute {
  const email = lead.contactEmail?.trim();
  if (email) {
    return isFreemail(email) ? "freemail" : "email";
  }
  if (lead.contactPhone?.trim()) return "phone";
  if (lead.contactFormUrl?.trim()) return "form";
  return "none";
}

export const CONTACT_ROUTE_META: Record<
  ContactRoute,
  { label: string; className: string; title?: string }
> = {
  email: { label: "Email", className: "contact-route contact-route-email" },
  freemail: {
    label: "Freemail",
    className: "contact-route contact-route-freemail",
    title:
      "Consumer mailbox — the send gate always refuses freemail (PECR / deliverability).",
  },
  phone: { label: "Phone", className: "contact-route contact-route-phone" },
  form: { label: "Form", className: "contact-route contact-route-form" },
  none: { label: "No contact", className: "contact-route contact-route-none" },
};
