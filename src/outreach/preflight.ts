import type { OutreachSettings } from "../../shared/outreach";
import type { Env } from "../schema";
import { resolvePostalAddress } from "./copy";
import { isPrimarySendingDomain } from "../outreach-send";

export type PreflightCheckKey =
  | "sending_domain_set"
  | "from_address_set"
  | "from_domain_not_primary"
  | "postal_address_set"
  | "unsubscribe_key_set"
  | "resend_key_set"
  | "reply_to_set";

export type PreflightChecks = Record<PreflightCheckKey, boolean>;

export type OutreachPreflight = {
  ready: boolean;
  checks: PreflightChecks;
  blocking: PreflightCheckKey[];
};

const REQUIRED: PreflightCheckKey[] = [
  "sending_domain_set",
  "from_address_set",
  "from_domain_not_primary",
  "postal_address_set",
  "unsubscribe_key_set",
  "resend_key_set",
];

type PreflightEnv = Pick<
  Env,
  | "OUTREACH_FROM"
  | "OUTREACH_REPLY_TO"
  | "OUTREACH_POSTAL_ADDRESS"
  | "UNSUBSCRIBE_SIGNING_KEY"
  | "RESEND_API_KEY"
>;

/** Public boolean-only readiness report — never includes secret values. */
export function buildOutreachPreflight(
  settings: Pick<
    OutreachSettings,
    "sendingDomain" | "fromAddress" | "replyTo" | "postalAddress"
  >,
  env: PreflightEnv
): OutreachPreflight {
  const from = (settings.fromAddress || env.OUTREACH_FROM || "").trim();
  const replyTo = (settings.replyTo || env.OUTREACH_REPLY_TO || "").trim();

  const checks: PreflightChecks = {
    sending_domain_set: Boolean(settings.sendingDomain?.trim()),
    from_address_set: Boolean(from),
    from_domain_not_primary: !from || !isPrimarySendingDomain(from),
    postal_address_set: Boolean(resolvePostalAddress(settings, env)),
    unsubscribe_key_set: Boolean(env.UNSUBSCRIBE_SIGNING_KEY?.trim()),
    resend_key_set: Boolean(env.RESEND_API_KEY?.trim()),
    reply_to_set: Boolean(replyTo),
  };

  const blocking = REQUIRED.filter((key) => !checks[key]);
  return {
    ready: blocking.length === 0,
    checks,
    blocking,
  };
}
