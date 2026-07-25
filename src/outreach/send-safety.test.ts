import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, OutreachSettings } from "../../shared/outreach";
import type { Env } from "../schema";

const insertLeadMessage = vi.fn();
const setLeadReviewReasons = vi.fn();
const countSentToday = vi.fn();
const getLeadMessageByIdempotency = vi.fn();
const isSuppressed = vi.fn();
const updateLead = vi.fn();
const createLeadReminder = vi.fn();
const sendResendEmail = vi.fn();

vi.mock("../outreach-db", () => ({
  countSentToday: (...args: unknown[]) => countSentToday(...args),
  createLeadReminder: (...args: unknown[]) => createLeadReminder(...args),
  getLeadMessageByIdempotency: (...args: unknown[]) => getLeadMessageByIdempotency(...args),
  insertLeadMessage: (...args: unknown[]) => insertLeadMessage(...args),
  isSuppressed: (...args: unknown[]) => isSuppressed(...args),
  leadGateInput: (lead: Lead) => ({
    priorityScore: lead.priorityScore,
    corporateSubscriber: lead.corporateSubscriber,
    emailVerified: lead.emailVerified,
    contactEmail: lead.contactEmail,
    suppressed: lead.suppressed,
    demoStatus: lead.demoStatus,
    demoUrl: lead.demoUrl,
    status: lead.status,
  }),
  setLeadReviewReasons: (...args: unknown[]) => setLeadReviewReasons(...args),
  settingsGateInput: (s: OutreachSettings) => ({
    autoSendEnabled: s.autoSendEnabled,
    dryRun: s.dryRun,
    autoSendThreshold: s.autoSendThreshold,
    dailySendCap: s.dailySendCap,
    pausedUntil: s.pausedUntil,
  }),
  updateLead: (...args: unknown[]) => updateLead(...args),
}));

vi.mock("../email", () => ({
  sendResendEmail: (...args: unknown[]) => sendResendEmail(...args),
}));

const {
  constantTimeEqualHex,
  isPrimarySendingDomain,
  sendLeadOutreach,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = await import("../outreach-send");

function baseLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    businessName: "Acme Ltd",
    slug: "acme-ltd",
    industry: "accountants",
    location: "Bristol",
    postcode: "BS1 1AA",
    address: null,
    contactName: "Jane",
    contactEmail: "jane@acme-ltd.co.uk",
    contactPhone: null,
    contactFormUrl: null,
    emailSource: null,
    emailVerified: true,
    websiteUrl: "https://acme-ltd.co.uk",
    hasWebsite: true,
    companiesHouseNumber: null,
    entityType: "ltd",
    corporateSubscriber: true,
    chStatus: null,
    incorporatedOn: null,
    audit: { https: false },
    needScore: 8,
    likelihoodScore: 8,
    priorityScore: 9,
    scoreReason: null,
    demoUrl: "https://acme-ltd.example-demos.test",
    demoBuiltAt: null,
    demoExpiresAt: null,
    demoStatus: "ready",
    status: "demo_ready",
    sentAt: null,
    lastTouchAt: null,
    nextFollowupAt: null,
    followupStep: 0,
    repliedAt: null,
    replySentiment: null,
    suppressed: false,
    suppressionReason: null,
    offerAmount: 500,
    source: null,
    sourceRef: null,
    reviewReasons: [],
    ...over,
  };
}

function baseSettings(over: Partial<OutreachSettings> = {}): OutreachSettings {
  return {
    id: 1,
    autoSendEnabled: false,
    autoSendThreshold: 8,
    dailySendCap: 20,
    sendingDomain: null,
    fromAddress: "Outreach <hello@outreach.example>",
    replyTo: null,
    postalAddress: "Humza Butt, United Kingdom",
    followupOffsetsDays: [3, 7],
    dryRun: true,
    pausedUntil: null,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function baseEnv(over: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: "postgres://test",
    API_KEY: "api-key-master",
    DOCS: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    RESEND_API_KEY: "re_test",
    OUTREACH_FROM: undefined,
    UNSUBSCRIBE_SIGNING_KEY: "unsub-secret-key",
    ...over,
  };
}

const sql = Object.assign(
  async () => [{ id: 1 }],
  { begin: async () => undefined }
) as unknown as import("../db").Sql;

describe("send safety helpers", () => {
  it("detects primary portfolio domains", () => {
    expect(isPrimarySendingDomain("Outreach <outreach@humza-butt.space>")).toBe(true);
    expect(isPrimarySendingDomain("Outreach <outreach@mail.humza-butt.space>")).toBe(true);
    expect(isPrimarySendingDomain("hello@outreach.example")).toBe(false);
  });

  it("constantTimeEqualHex accepts equal and rejects tampered", () => {
    expect(constantTimeEqualHex("abcd", "abcd")).toBe(true);
    expect(constantTimeEqualHex("abcd", "abce")).toBe(false);
    expect(constantTimeEqualHex("abc", "abcd")).toBe(false);
  });

  it("verifyUnsubscribeToken accepts valid and rejects tampered", async () => {
    const secret = "unsub-secret-key";
    const token = await signUnsubscribeToken(secret, 7, "jane@acme-ltd.co.uk");
    await expect(verifyUnsubscribeToken(secret, token)).resolves.toEqual({
      leadId: 7,
      email: "jane@acme-ltd.co.uk",
    });
    const lastDot = token.lastIndexOf(".");
    const tampered = `${token.slice(0, lastDot)}.${"0".repeat(token.length - lastDot - 1)}`;
    await expect(verifyUnsubscribeToken(secret, tampered)).resolves.toBeNull();
  });
});

describe("sendLeadOutreach fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countSentToday.mockResolvedValue(0);
    isSuppressed.mockResolvedValue(false);
    getLeadMessageByIdempotency.mockResolvedValue(null);
    insertLeadMessage.mockResolvedValue({ id: 99 });
    setLeadReviewReasons.mockResolvedValue(undefined);
    updateLead.mockResolvedValue(null);
    createLeadReminder.mockResolvedValue(null);
    sendResendEmail.mockResolvedValue({ sent: true });
  });

  it("force: true with dry_run still queues and does not call Resend", async () => {
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: true, autoSendEnabled: false }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.reasons).toContain("dry_run");
    expect(insertLeadMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "queued" })
    );
    expect(sendResendEmail).not.toHaveBeenCalled();
  });

  it("overrideDryRun is the only path that sends while dry_run is true", async () => {
    const forced = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      force: true,
    });
    expect(forced.dryRun).toBe(true);
    expect(sendResendEmail).not.toHaveBeenCalled();

    getLeadMessageByIdempotency.mockResolvedValue(null);
    insertLeadMessage.mockResolvedValue({ id: 100 });

    const live = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ id: 2 }),
      settings: baseSettings({ dryRun: true, autoSendEnabled: true }),
      origin: "https://example.com",
      overrideDryRun: true,
    });
    expect(live.sent).toBe(true);
    expect(live.dryRun).toBe(false);
    expect(sendResendEmail).toHaveBeenCalled();
  });

  it("unset from-address → sending_identity_not_configured, nothing written", async () => {
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv({ OUTREACH_FROM: undefined }),
      lead: baseLead(),
      settings: baseSettings({ fromAddress: null }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.reasons).toEqual(["sending_identity_not_configured"]);
    expect(insertLeadMessage).not.toHaveBeenCalled();
    expect(sendResendEmail).not.toHaveBeenCalled();
  });

  it("from on humza-butt.space → sending_domain_is_primary", async () => {
    for (const fromAddress of [
      "Outreach <outreach@humza-butt.space>",
      "Outreach <outreach@mail.humza-butt.space>",
    ]) {
      insertLeadMessage.mockClear();
      const result = await sendLeadOutreach({
        sql,
        env: baseEnv(),
        lead: baseLead(),
        settings: baseSettings({ fromAddress }),
        origin: "https://example.com",
        force: true,
      });
      expect(result.reasons).toEqual(["sending_domain_is_primary"]);
      expect(insertLeadMessage).not.toHaveBeenCalled();
    }
  });

  it("unset postal → postal_address_not_configured", async () => {
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv({ OUTREACH_POSTAL_ADDRESS: undefined }),
      lead: baseLead(),
      settings: baseSettings({ postalAddress: null }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.reasons).toEqual(["postal_address_not_configured"]);
    expect(insertLeadMessage).not.toHaveBeenCalled();
  });

  it("unset unsubscribe key → unsubscribe_key_not_configured", async () => {
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv({ UNSUBSCRIBE_SIGNING_KEY: undefined }),
      lead: baseLead(),
      settings: baseSettings(),
      origin: "https://example.com",
      force: true,
    });
    expect(result.reasons).toEqual(["unsubscribe_key_not_configured"]);
    expect(insertLeadMessage).not.toHaveBeenCalled();
  });
});
