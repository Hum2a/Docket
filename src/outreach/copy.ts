/**
 * Deterministic outreach copy — observation lines, subject variants, sequence bodies.
 * No LLM: audit signals only.
 */

export type ObservationSignal =
  | "no_website"
  | "social_only"
  | "https"
  | "mobile_friendly"
  | "lcp_ms"
  | "psi_mobile"
  | "broken_links"
  | "broken_form"
  | "cms_outdated"
  | "footer_year"
  | "builder"
  | "generic";

export type SubjectVariant = "A" | "B" | "C" | "D";

export type OutreachTemplateId = "initial" | "followup" | "final" | "custom";

export type OutreachAuditMeta = {
  signal: ObservationSignal;
  subjectVariant: SubjectVariant;
  originalSubject: string;
};

export type CopyLeadInput = {
  id: number;
  businessName: string;
  slug: string;
  industry: string | null;
  location: string | null;
  contactName: string | null;
  websiteUrl: string | null;
  demoUrl: string | null;
  /** ISO timestamp; when set, final email uses this instead of now+3d. */
  demoExpiresAt: string | null;
  offerAmount: number;
  audit: Record<string, unknown>;
};

export type RenderedOutreach = {
  subject: string;
  text: string;
  variant: SubjectVariant | null;
  signal: ObservationSignal;
  templateId: OutreachTemplateId;
};

const MOBILE_SPEED_SIGNALS: ObservationSignal[] = [
  "mobile_friendly",
  "lcp_ms",
  "psi_mobile",
];

export function bareDomain(websiteUrl: string | null | undefined): string {
  if (!websiteUrl?.trim()) return "";
  try {
    const withProto = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, "");
    return host;
  } catch {
    return websiteUrl
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .trim();
  }
}

export function firstName(contactName: string | null | undefined): string {
  const raw = contactName?.trim() || "";
  if (!raw) return "";
  return raw.split(/\s+/)[0] || "";
}

export function greeting(contactName: string | null | undefined): string {
  const name = firstName(contactName);
  return name ? `Hi ${name},` : "Hi,";
}

const INDUSTRY_PLURAL: Record<string, string> = {
  accountant: "accountants",
  accountants: "accountants",
  accounting: "accountants",
  solicitor: "solicitors",
  solicitors: "solicitors",
  law: "solicitors",
  legal: "solicitors",
  consultancy: "consultancies",
  consultancies: "consultancies",
  consultant: "consultancies",
  consulting: "consultancies",
  "driving school": "driving schools",
  "driving schools": "driving schools",
};

export function industryPlural(industry: string | null | undefined): string {
  const key = (industry || "").trim().toLowerCase();
  if (!key) return "professional-services firms";
  if (INDUSTRY_PLURAL[key]) return INDUSTRY_PLURAL[key];
  if (key.endsWith("ies")) return key;
  if (key.endsWith("y")) return `${key.slice(0, -1)}ies`;
  if (key.endsWith("s")) return key;
  return `${key}s`;
}

export function demoUrlFor(lead: Pick<CopyLeadInput, "demoUrl" | "slug">): string {
  if (lead.demoUrl?.trim()) return lead.demoUrl.trim();
  return `https://${lead.slug}.humza-butt.space`;
}

function auditNum(audit: Record<string, unknown>, key: string): number | null {
  const v = audit[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function auditBool(audit: Record<string, unknown>, key: string): boolean | null {
  const v = audit[key];
  if (typeof v === "boolean") return v;
  return null;
}

function psiMobileScore(audit: Record<string, unknown>): number | null {
  const psi = audit.psi_mobile;
  if (psi && typeof psi === "object" && !Array.isArray(psi)) {
    const perf = (psi as Record<string, unknown>).performance;
    if (typeof perf === "number") return perf;
  }
  return null;
}

export function pickObservation(
  lead: Pick<CopyLeadInput, "websiteUrl" | "audit">,
  now: Date = new Date()
): { signal: ObservationSignal; line: string } {
  const audit = lead.audit || {};
  const domain = bareDomain(lead.websiteUrl);

  if (!lead.websiteUrl?.trim()) {
    return {
      signal: "no_website",
      line: "You don't seem to have a website yet — just the Google listing.",
    };
  }

  if (audit.social_only === true) {
    return {
      signal: "social_only",
      line: "Your Google listing points at Facebook rather than a website.",
    };
  }

  if (auditBool(audit, "https") === false) {
    return {
      signal: "https",
      line: `Chrome shows a "Not secure" warning on ${domain} — it appears before anyone reads a word.`,
    };
  }

  if (auditBool(audit, "mobile_friendly") === false) {
    return {
      signal: "mobile_friendly",
      line: `${domain} doesn't resize on a phone — you have to pinch and zoom to read it.`,
    };
  }

  const lcp = auditNum(audit, "lcp_ms");
  if (lcp != null && lcp > 4000) {
    const secs = Math.round(lcp / 1000);
    return {
      signal: "lcp_ms",
      line: `${domain} takes about ${secs} seconds to load on a phone. Most people don't wait.`,
    };
  }

  const score = psiMobileScore(audit);
  if (score != null && score < 40) {
    return {
      signal: "psi_mobile",
      line: `${domain} scores ${Math.round(score)}/100 on Google's mobile speed test, which feeds into search ranking.`,
    };
  }

  const broken = auditNum(audit, "broken_links");
  if (broken != null && broken > 0) {
    const page =
      (typeof audit.broken_link_page === "string" && audit.broken_link_page) ||
      (typeof audit.broken_page === "string" && audit.broken_page) ||
      "contact";
    return {
      signal: "broken_links",
      line: `A few links on ${domain} lead to error pages — including the ${page} one.`,
    };
  }

  const brokenForm = audit.broken_form;
  if (brokenForm && typeof brokenForm === "object" && !Array.isArray(brokenForm)) {
    const bf = brokenForm as Record<string, unknown>;
    const name = typeof bf.name === "string" ? bf.name.trim() : "";
    const fault = typeof bf.fault === "string" ? bf.fault.trim() : "";
    if (name && fault) {
      return {
        signal: "broken_form",
        line: `The ${name} on ${domain} ${fault} — so nobody can complete it properly.`,
      };
    }
  }

  const cmsOutdated = audit.cms_outdated;
  if (cmsOutdated && typeof cmsOutdated === "object" && !Array.isArray(cmsOutdated)) {
    const cms = cmsOutdated as Record<string, unknown>;
    const cmsName = typeof cms.cms === "string" ? cms.cms.trim() : "";
    const version = typeof cms.version === "string" ? cms.version.trim() : "";
    const eol =
      typeof cms.eol_year === "number"
        ? cms.eol_year
        : typeof cms.eol_year === "string" && Number.isFinite(Number(cms.eol_year))
          ? Number(cms.eol_year)
          : null;
    if (cmsName && version && eol != null) {
      return {
        signal: "cms_outdated",
        line: `${domain} is running ${cmsName} ${version}, which stopped getting security updates in ${Math.round(eol)}.`,
      };
    }
  }

  const footerYear = auditNum(audit, "footer_year");
  const currentYear = now.getFullYear();
  if (footerYear != null && footerYear <= currentYear - 5) {
    return {
      signal: "footer_year",
      line: `The footer on ${domain} still says ${Math.round(footerYear)}.`,
    };
  }

  if (typeof audit.builder === "string" && audit.builder.trim()) {
    return {
      signal: "builder",
      line: `${domain} is built on ${audit.builder.trim()}, and hasn't had much attention since it went up.`,
    };
  }

  return {
    signal: "generic",
    line: domain
      ? `I had a look at ${domain} and put together something cleaner for how you work today.`
      : "I put together a cleaner site for how you work today.",
  };
}

export function consequenceLine(signal: ObservationSignal): string {
  switch (signal) {
    case "no_website":
    case "social_only":
      return "Worth noting most people search before they call — right now there's nothing to find.";
    case "https":
      return 'That "Not secure" warning is the first thing a prospective client sees.';
    case "mobile_friendly":
    case "lcp_ms":
    case "psi_mobile":
      return "Roughly two-thirds of people who look you up will be doing it on a phone.";
    case "broken_form":
      return "Anyone who tried to get in touch through that form never reached you.";
    case "cms_outdated":
      return "Unpatched sites are the ones that get defaced — it's usually automated, not personal.";
    case "footer_year":
    case "builder":
    case "broken_links":
    case "generic":
    default:
      return "Nothing wrong with the current one — this just looks like the firm you are now.";
  }
}

export function isMobileSpeedSignal(signal: ObservationSignal): boolean {
  return MOBILE_SPEED_SIGNALS.includes(signal);
}

export function pickSubjectVariant(
  signal: ObservationSignal,
  leadId: number
): SubjectVariant {
  const allowed: SubjectVariant[] = isMobileSpeedSignal(signal)
    ? ["A", "B", "C", "D"]
    : ["A", "B", "D"];
  const idx = Math.abs(leadId) % allowed.length;
  return allowed[idx]!;
}

export function subjectForVariant(
  variant: SubjectVariant,
  lead: Pick<CopyLeadInput, "businessName" | "websiteUrl">
): string {
  const domain = bareDomain(lead.websiteUrl) || lead.businessName;
  switch (variant) {
    case "A":
      return `demo site for ${lead.businessName}`;
    case "B":
      return `built something for ${lead.businessName}`;
    case "C":
      return `${domain} on mobile`;
    case "D":
      return `${lead.businessName} — worth 60 seconds?`;
  }
}

export function appendFooter(
  body: string,
  postalAddress: string,
  unsubscribeUrl: string
): string {
  return `${body.trim()}\n\n--\nHumza Butt · ${postalAddress}\nDon't want these? ${unsubscribeUrl}\n`;
}

/**
 * For the initial step only: if a hand-written body is set, use it verbatim and
 * still append the system footer. Follow-ups ignore custom fields.
 */
export function applyCustomInitialCopy(
  generated: RenderedOutreach,
  customBody: string | null | undefined,
  customSubject: string | null | undefined,
  postalAddress: string,
  unsubscribeUrl: string
): RenderedOutreach {
  if (generated.templateId !== "initial") return generated;
  const body = customBody?.trim();
  if (!body) return generated;
  return {
    subject: customSubject?.trim() || generated.subject,
    text: appendFooter(body, postalAddress, unsubscribeUrl),
    variant: generated.variant,
    signal: generated.signal,
    templateId: "custom",
  };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function formatExpiryDate(from: Date = new Date(), daysAhead = 3): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Absolute follow-up instant: sentAt + offsetDays (calendar days). */
export function absoluteFollowupAt(sentAt: Date | string, offsetDays: number): string {
  const base = typeof sentAt === "string" ? new Date(sentAt) : new Date(sentAt.getTime());
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString();
}

export function resolveTemplateId(
  followupStep: number,
  explicit?: string
): Exclude<OutreachTemplateId, "custom"> {
  if (explicit === "initial" || explicit === "followup" || explicit === "final") {
    return explicit;
  }
  if (explicit === "followup_1") return "followup";
  if (explicit === "followup_2") return "final";
  if (followupStep <= 0) return "initial";
  if (followupStep === 1) return "followup";
  return "final";
}

export function getPersistedOutreach(
  audit: Record<string, unknown>
): OutreachAuditMeta | null {
  const raw = audit.outreach;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.signal !== "string" ||
    typeof o.subjectVariant !== "string" ||
    typeof o.originalSubject !== "string"
  ) {
    return null;
  }
  return {
    signal: o.signal as ObservationSignal,
    subjectVariant: o.subjectVariant as SubjectVariant,
    originalSubject: o.originalSubject,
  };
}

export function renderInitial(opts: {
  lead: CopyLeadInput;
  postalAddress: string;
  unsubscribeUrl: string;
  now?: Date;
}): RenderedOutreach {
  const { lead, postalAddress, unsubscribeUrl } = opts;
  const { signal, line } = pickObservation(lead, opts.now);
  const variant = pickSubjectVariant(signal, lead.id);
  const subject = subjectForVariant(variant, lead);
  const demo = demoUrlFor(lead);
  const location = lead.location?.trim() || "the UK";
  const amount = Number(lead.offerAmount || 500);

  const body = `${greeting(lead.contactName)}

${line}

I build websites for ${industryPlural(lead.industry)} around ${location}. Rather than pitch,
I've already built you one:

${demo}

That's your real services, address and opening hours — not a generic mockup.
Worth opening on your phone.

£${amount} flat and it's live on your own domain. If it's not for you, no harm done.

Want it? Just reply and I'll take it from there.

Humza
humza-butt.space`;

  return {
    subject,
    text: appendFooter(body, postalAddress, unsubscribeUrl),
    variant,
    signal,
    templateId: "initial",
  };
}

export function renderFollowup(opts: {
  lead: CopyLeadInput;
  postalAddress: string;
  unsubscribeUrl: string;
  signal: ObservationSignal;
  originalSubject: string;
}): RenderedOutreach {
  const { lead, postalAddress, unsubscribeUrl, signal, originalSubject } = opts;
  const demo = demoUrlFor(lead);
  const reSubject = originalSubject.startsWith("Re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const body = `${greeting(lead.contactName)}

The demo's still up if you didn't get a chance:

${demo}

${consequenceLine(signal)}

Still £${Number(lead.offerAmount || 500)}. Reply and it's yours.

Humza`;

  return {
    subject: reSubject,
    text: appendFooter(body, postalAddress, unsubscribeUrl),
    variant: null,
    signal,
    templateId: "followup",
  };
}

export function renderFinal(opts: {
  lead: CopyLeadInput;
  postalAddress: string;
  unsubscribeUrl: string;
  originalSubject: string;
  signal: ObservationSignal;
  now?: Date;
}): RenderedOutreach {
  const { lead, postalAddress, unsubscribeUrl, originalSubject, signal } = opts;
  const demo = demoUrlFor(lead);
  const expiry = lead.demoExpiresAt
    ? formatExpiryDate(new Date(lead.demoExpiresAt), 0)
    : formatExpiryDate(opts.now ?? new Date(), 3);
  const reSubject = originalSubject.startsWith("Re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const body = `${greeting(lead.contactName)}

Last one from me — I'll take the demo down on ${expiry} to free up the address.

${demo}

If you'd like it, reply before then and it's yours for £${Number(lead.offerAmount || 500)}. Otherwise I'll
leave you to it.

Good luck with ${lead.businessName}.

Humza`;

  return {
    subject: reSubject,
    text: appendFooter(body, postalAddress, unsubscribeUrl),
    variant: null,
    signal,
    templateId: "final",
  };
}

export function renderOutreachCopy(opts: {
  lead: CopyLeadInput;
  postalAddress: string;
  unsubscribeUrl: string;
  templateId: OutreachTemplateId;
  now?: Date;
}): RenderedOutreach {
  const persisted = getPersistedOutreach(opts.lead.audit);
  if (opts.templateId === "initial") {
    return renderInitial(opts);
  }
  const signal = persisted?.signal ?? pickObservation(opts.lead, opts.now).signal;
  const originalSubject =
    persisted?.originalSubject ??
    subjectForVariant(pickSubjectVariant(signal, opts.lead.id), opts.lead);
  if (opts.templateId === "followup") {
    return renderFollowup({ ...opts, signal, originalSubject });
  }
  return renderFinal({ ...opts, signal, originalSubject });
}

/** Soft check used in tests — body before footer. */
export function bodyWordCountBeforeFooter(text: string): number {
  const cut = text.split(/\n--\n/)[0] ?? text;
  return wordCount(cut);
}

/** Postal address is required before any outreach send (PECR identity). */
export function resolvePostalAddress(
  settings: { postalAddress?: string | null },
  env: { OUTREACH_POSTAL_ADDRESS?: string }
): string | null {
  const fromSettings = settings.postalAddress?.trim();
  if (fromSettings) return fromSettings;
  const fromEnv = env.OUTREACH_POSTAL_ADDRESS?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

