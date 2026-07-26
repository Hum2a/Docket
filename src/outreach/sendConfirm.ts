/**
 * Helpers for the send-confirmation modal — keep preview identical to what Resend gets.
 */

import {
  applyCustomInitialCopy,
  renderOutreachCopy,
  resolveTemplateId,
  type CopyLeadInput,
  type RenderedOutreach,
} from "./copy";
import { isQualityHardReason } from "./qualityGate";
import { labelGateReason } from "../../shared/manualGate";

export type SendConfirmPreviewInput = {
  lead: CopyLeadInput;
  postalAddress: string;
  unsubscribeUrl: string;
  customBody?: string | null;
  customSubject?: string | null;
  followupStep?: number;
  templateId?: string;
};

/** Exact subject + body (footer included) the recipient will see. */
export function buildSendConfirmPreview(input: SendConfirmPreviewInput): RenderedOutreach {
  const templateId = resolveTemplateId(input.followupStep ?? 0, input.templateId);
  const generated = renderOutreachCopy({
    lead: input.lead,
    postalAddress: input.postalAddress,
    unsubscribeUrl: input.unsubscribeUrl,
    templateId,
  });
  return applyCustomInitialCopy(
    generated,
    input.customBody,
    input.customSubject,
    input.postalAddress,
    input.unsubscribeUrl
  );
}

/** Confirm must stay disabled when any quality hard-block (or other hard reason) remains. */
export function sendConfirmBlocked(reasons: string[]): boolean {
  return reasons.length > 0;
}

export function sendConfirmBlockLabels(reasons: string[]): string[] {
  return reasons.map(labelGateReason);
}

export function hasQualityHardBlock(reasons: string[]): boolean {
  return reasons.some(isQualityHardReason);
}
