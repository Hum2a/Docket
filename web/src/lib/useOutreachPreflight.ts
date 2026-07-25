import { useCallback, useEffect, useState } from "react";
import { api, type OutreachPreflight, type PreflightCheckKey } from "./api";

export const PREFLIGHT_HINTS: Record<PreflightCheckKey, string> = {
  sending_domain_set: "Set sending domain in Outreach settings (or via API).",
  from_address_set: "Set from address in settings or OUTREACH_FROM secret.",
  from_domain_not_primary:
    "From address must not use humza-butt.space — use a dedicated outreach domain.",
  postal_address_set: "Set postal address in settings or OUTREACH_POSTAL_ADDRESS secret.",
  unsubscribe_key_set: "Set UNSUBSCRIBE_SIGNING_KEY via npm run secrets:sync.",
  resend_key_set: "Set RESEND_API_KEY via npm run secrets:resend.",
  reply_to_set: "Optional: set reply-to in settings or OUTREACH_REPLY_TO.",
};

export const PREFLIGHT_LABELS: Record<PreflightCheckKey, string> = {
  sending_domain_set: "Sending domain",
  from_address_set: "From address",
  from_domain_not_primary: "From domain is not primary portfolio",
  postal_address_set: "Postal address",
  unsubscribe_key_set: "Unsubscribe signing key",
  resend_key_set: "Resend API key",
  reply_to_set: "Reply-to (optional)",
};

export function blockingTooltip(blocking: PreflightCheckKey[]): string {
  if (blocking.length === 0) return "";
  return blocking.map((k) => PREFLIGHT_HINTS[k]).join(" ");
}

export function useOutreachPreflight() {
  const [preflight, setPreflight] = useState<OutreachPreflight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreflight(await api.getOutreachPreflight());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { preflight, error, loading, reload, ready: preflight?.ready === true };
}
