import type { OutreachSettings } from "../../shared/outreach";
import type { Env } from "../schema";
import { resolvePostalAddress } from "./copy";
import { extractFromAddress, isPrimarySendingDomain } from "../outreach-send";
import { emailDomain } from "./canAutoSend";
import { resolvePersonalFrom } from "./warmSend";

export type PreflightCheckKey =
  | "sending_domain_set"
  | "from_address_set"
  | "from_domain_not_primary"
  | "postal_address_set"
  | "unsubscribe_key_set"
  | "resend_key_set"
  | "reply_to_set"
  | "personal_from_set"
  | "personal_from_domain_verified";

export type PreflightChecks = Record<PreflightCheckKey, boolean>;

export type OutreachPreflight = {
  ready: boolean;
  warmReady: boolean;
  checks: PreflightChecks;
  blocking: PreflightCheckKey[];
  warmBlocking: PreflightCheckKey[];
  warnings: PreflightCheckKey[];
};

const ALWAYS_REQUIRED: PreflightCheckKey[] = [
  "sending_domain_set",
  "from_address_set",
  "postal_address_set",
  "unsubscribe_key_set",
  "resend_key_set",
];

const WARM_REQUIRED: PreflightCheckKey[] = [
  "personal_from_set",
  "postal_address_set",
  "unsubscribe_key_set",
  "resend_key_set",
];

type PreflightEnv = Pick<
  Env,
  | "OUTREACH_FROM"
  | "OUTREACH_REPLY_TO"
  | "OUTREACH_POSTAL_ADDRESS"
  | "OUTREACH_PERSONAL_FROM"
  | "UNSUBSCRIBE_SIGNING_KEY"
  | "RESEND_API_KEY"
>;

let domainCache: { at: number; names: Set<string> } | null = null;
const DOMAIN_CACHE_MS = 60 * 60 * 1000;

async function listVerifiedResendDomains(apiKey: string): Promise<Set<string>> {
  if (domainCache && Date.now() - domainCache.at < DOMAIN_CACHE_MS) {
    return domainCache.names;
  }
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return domainCache?.names ?? new Set();
  const body = (await res.json()) as { data?: Array<{ name?: string; status?: string }> };
  const names = new Set(
    (body.data ?? [])
      .filter((d) => (d.status || "").toLowerCase() === "verified" && d.name)
      .map((d) => d.name!.toLowerCase())
  );
  domainCache = { at: Date.now(), names };
  return names;
}

/** Public boolean-only readiness report — never includes secret values. */
export async function buildOutreachPreflight(
  settings: Pick<
    OutreachSettings,
    | "sendingDomain"
    | "fromAddress"
    | "replyTo"
    | "postalAddress"
    | "allowPrimarySendingDomain"
  >,
  env: PreflightEnv
): Promise<OutreachPreflight> {
  const from = (settings.fromAddress || env.OUTREACH_FROM || "").trim();
  const replyTo = (settings.replyTo || env.OUTREACH_REPLY_TO || "").trim();
  const personalFrom = resolvePersonalFrom(env);

  const checks: PreflightChecks = {
    sending_domain_set: Boolean(settings.sendingDomain?.trim()),
    from_address_set: Boolean(from),
    from_domain_not_primary: !from || !isPrimarySendingDomain(from),
    postal_address_set: Boolean(resolvePostalAddress(settings, env)),
    unsubscribe_key_set: Boolean(env.UNSUBSCRIBE_SIGNING_KEY?.trim()),
    resend_key_set: Boolean(env.RESEND_API_KEY?.trim()),
    reply_to_set: Boolean(replyTo),
    personal_from_set: Boolean(personalFrom),
    personal_from_domain_verified: false,
  };

  if (env.RESEND_API_KEY && personalFrom) {
    const domain = emailDomain(extractFromAddress(personalFrom));
    if (domain) {
      const verified = await listVerifiedResendDomains(env.RESEND_API_KEY);
      checks.personal_from_domain_verified = verified.has(domain);
    }
  }

  const blocking = ALWAYS_REQUIRED.filter((key) => !checks[key]);
  if (!settings.allowPrimarySendingDomain && !checks.from_domain_not_primary) {
    blocking.push("from_domain_not_primary");
  }

  const warmBlocking = WARM_REQUIRED.filter((key) => !checks[key]);

  const warnings: PreflightCheckKey[] = [];
  if (settings.allowPrimarySendingDomain && !checks.from_domain_not_primary) {
    warnings.push("from_domain_not_primary");
  }
  if (checks.personal_from_set && !checks.personal_from_domain_verified) {
    warnings.push("personal_from_domain_verified");
  }

  return {
    ready: blocking.length === 0,
    warmReady: warmBlocking.length === 0,
    checks,
    blocking,
    warmBlocking,
    warnings,
  };
}

export function resetResendDomainCache(): void {
  domainCache = null;
}
