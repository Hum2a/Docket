import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, OutreachSettings } from "../../shared/outreach";
import type { Env } from "../schema";

const insertLeadMessage = vi.fn();
const updateLeadMessageAttempt = vi.fn();
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
  getInitialOutboundProviderId: async () => null,
  getLeadMessageByIdempotency: (...args: unknown[]) => getLeadMessageByIdempotency(...args),
  insertLeadMessage: (...args: unknown[]) => insertLeadMessage(...args),
  updateLeadMessageAttempt: (...args: unknown[]) => updateLeadMessageAttempt(...args),
  MAX_MESSAGE_SEND_ATTEMPTS: 5,
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
    customSubject: null,
    customBody: null,
    draftUpdatedAt: null,
    contactRoute: "email",
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
    allowPrimarySendingDomain: false,
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
    updateLeadMessageAttempt.mockResolvedValue({ id: 99, attempts: 2 });
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
        settings: baseSettings({ fromAddress, allowPrimarySendingDomain: false }),
        origin: "https://example.com",
        force: true,
      });
      expect(result.reasons).toEqual(["sending_domain_is_primary"]);
      expect(insertLeadMessage).not.toHaveBeenCalled();
    }
  });

  it("allowPrimarySendingDomain:true permits primary from-address and logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fromAddress = "Outreach <outreach@mail.humza-butt.space>";
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ fromAddress, allowPrimarySendingDomain: true }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.reasons).not.toContain("sending_domain_is_primary");
    expect(result.dryRun).toBe(true);
    expect(insertLeadMessage).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    const logged = String(warn.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("primary_sending_domain_allowed");
    expect(logged).toContain("mail.humza-butt.space");
    warn.mockRestore();
  });

  it("allowPrimarySendingDomain does not weaken PECR, freemail, or suppression", async () => {
    const primaryFrom = "Outreach <outreach@mail.humza-butt.space>";
    const settings = baseSettings({
      fromAddress: primaryFrom,
      allowPrimarySendingDomain: true,
    });

    const soleTrader = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ corporateSubscriber: false }),
      settings,
      origin: "https://example.com",
      force: true,
    });
    expect(soleTrader.reasons).toContain("not_corporate_subscriber");
    expect(insertLeadMessage).not.toHaveBeenCalled();

    insertLeadMessage.mockClear();
    const freemail = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ contactEmail: "jane@gmail.com" }),
      settings,
      origin: "https://example.com",
      force: true,
    });
    expect(freemail.reasons).toContain("freemail_address");
    expect(insertLeadMessage).not.toHaveBeenCalled();

    insertLeadMessage.mockClear();
    const suppressed = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ suppressed: true }),
      settings,
      origin: "https://example.com",
      force: true,
    });
    expect(suppressed.reasons).toContain("lead_suppressed");
    expect(insertLeadMessage).not.toHaveBeenCalled();
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

  it("custom_body is sent verbatim with footer once and templateId custom", async () => {
    const customBody = "Hi,\n\nThis is the hand-written draft for Saunders.\n\nHumza";
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({
        customBody,
        customSubject: "the MOT reminder form on your site",
      }),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.dryRun).toBe(true);
    expect(insertLeadMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateId: "custom",
        subject: "the MOT reminder form on your site",
        body: expect.stringContaining(customBody),
      })
    );
    const body = String(insertLeadMessage.mock.calls[0]?.[1]?.body ?? "");
    expect(body.split(/\n--\n/).length).toBe(2);
    expect(body).toContain("Don't want these?");
    expect(body).toContain("Humza Butt · Humza Butt, United Kingdom");
  });

  it("custom_body does not weaken PECR, freemail, suppression, or demo gates", async () => {
    const withDraft = {
      customBody: "Hi,\n\nHand-written.\n\nHumza",
      customSubject: "custom subject",
    };

    insertLeadMessage.mockClear();
    const sole = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ ...withDraft, corporateSubscriber: false }),
      settings: baseSettings(),
      origin: "https://example.com",
      force: true,
    });
    expect(sole.reasons).toContain("not_corporate_subscriber");
    expect(insertLeadMessage).not.toHaveBeenCalled();

    const freemail = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ ...withDraft, contactEmail: "a@gmail.com" }),
      settings: baseSettings(),
      origin: "https://example.com",
      force: true,
    });
    expect(freemail.reasons).toContain("freemail_address");

    const suppressed = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ ...withDraft, suppressed: true }),
      settings: baseSettings(),
      origin: "https://example.com",
      force: true,
    });
    expect(suppressed.reasons).toContain("lead_suppressed");

    const noDemo = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({
        ...withDraft,
        demoStatus: "none",
        demoUrl: null,
        status: "qualified",
      }),
      settings: baseSettings(),
      origin: "https://example.com",
      force: true,
    });
    expect(noDemo.reasons).toEqual(
      expect.arrayContaining(["demo_not_ready", "status_not_sendable"])
    );
  });

  it("follow-up step ignores initial custom_body and uses generated template", async () => {
    insertLeadMessage.mockClear();
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({
        followupStep: 1,
        status: "sent",
        sentAt: new Date().toISOString(),
        customBody: "THIS CUSTOM BODY MUST NOT APPEAR IN FOLLOWUP",
        customSubject: "custom subject must not win",
        audit: {
          outreach: {
            signal: "broken_links",
            subjectVariant: "A",
            originalSubject: "demo site for Acme Ltd",
          },
        },
      }),
      settings: baseSettings({ dryRun: true, autoSendEnabled: true }),
      origin: "https://example.com",
      force: true,
      templateId: "followup",
    });
    expect(result.dryRun).toBe(true);
    expect(insertLeadMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateId: "followup",
        body: expect.not.stringContaining("THIS CUSTOM BODY MUST NOT APPEAR IN FOLLOWUP"),
      })
    );
    const body = String(insertLeadMessage.mock.calls[0]?.[1]?.body ?? "");
    expect(body).toContain("The demo's still up");
  });

  it("manual:true skips priority but not PECR / freemail / suppression / demo", async () => {
    const lowPri = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ priorityScore: 1 }),
      settings: baseSettings({ autoSendThreshold: 8, dryRun: true }),
      origin: "https://example.com",
      force: true,
      manual: true,
    });
    expect(lowPri.reasons).not.toContain("priority_below_threshold");
    expect(lowPri.dryRun).toBe(true);
    expect(insertLeadMessage).toHaveBeenCalled();

    insertLeadMessage.mockClear();
    const sole = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ corporateSubscriber: false, priorityScore: 1 }),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      force: true,
      manual: true,
    });
    expect(sole.reasons).toContain("not_corporate_subscriber");
    expect(insertLeadMessage).not.toHaveBeenCalled();

    const freemail = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ contactEmail: "a@gmail.com", priorityScore: 1 }),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      force: true,
      manual: true,
    });
    expect(freemail.reasons).toContain("freemail_address");

    const suppressed = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ suppressed: true, priorityScore: 1 }),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      force: true,
      manual: true,
    });
    expect(suppressed.reasons).toContain("lead_suppressed");

    const noDemo = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({
        demoStatus: "none",
        demoUrl: null,
        status: "qualified",
        priorityScore: 1,
      }),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      force: true,
      manual: true,
    });
    expect(noDemo.reasons).toEqual(
      expect.arrayContaining(["demo_not_ready", "status_not_sendable"])
    );
  });
});

describe("sendLeadOutreach idempotency / retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countSentToday.mockResolvedValue(0);
    isSuppressed.mockResolvedValue(false);
    getLeadMessageByIdempotency.mockResolvedValue(null);
    insertLeadMessage.mockResolvedValue({ id: 99, attempts: 1 });
    updateLeadMessageAttempt.mockResolvedValue({ id: 42, attempts: 2, status: "sent" });
    setLeadReviewReasons.mockResolvedValue(undefined);
    updateLead.mockResolvedValue(null);
    createLeadReminder.mockResolvedValue(null);
    sendResendEmail.mockResolvedValue({ sent: true, id: "re_abc" });
  });

  it("existing sent row blocks with already_sent and does not call Resend", async () => {
    getLeadMessageByIdempotency.mockResolvedValue({
      id: 10,
      status: "sent",
      attempts: 1,
    });
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: false }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.reasons).toEqual(["already_sent"]);
    expect(result.sent).toBe(true);
    expect(sendResendEmail).not.toHaveBeenCalled();
    expect(insertLeadMessage).not.toHaveBeenCalled();
    expect(updateLeadMessageAttempt).not.toHaveBeenCalled();
  });

  it("existing bounced row blocks — must not re-send to a bounced address", async () => {
    getLeadMessageByIdempotency.mockResolvedValue({
      id: 11,
      status: "bounced",
      attempts: 1,
    });
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: false }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.reasons).toEqual(["already_sent"]);
    expect(result.sent).toBe(false);
    expect(sendResendEmail).not.toHaveBeenCalled();
    expect(insertLeadMessage).not.toHaveBeenCalled();
    expect(updateLeadMessageAttempt).not.toHaveBeenCalled();
  });

  it("existing failed row retries in place and increments attempts", async () => {
    getLeadMessageByIdempotency.mockResolvedValue({
      id: 42,
      status: "failed",
      attempts: 1,
      error: "domain_not_verified",
    });
    updateLeadMessageAttempt.mockResolvedValue({
      id: 42,
      attempts: 2,
      status: "sent",
    });

    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: false }),
      origin: "https://example.com",
      force: true,
    });

    expect(result.sent).toBe(true);
    expect(result.messageId).toBe(42);
    expect(sendResendEmail).toHaveBeenCalled();
    expect(insertLeadMessage).not.toHaveBeenCalled();
    expect(updateLeadMessageAttempt).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.objectContaining({
        status: "sent",
        error: null,
        providerMessageId: "re_abc",
      })
    );
  });

  it("queued dry-run row is superseded in place with no second row", async () => {
    getLeadMessageByIdempotency.mockResolvedValue({
      id: 55,
      status: "queued",
      attempts: 1,
    });
    updateLeadMessageAttempt.mockResolvedValue({
      id: 55,
      attempts: 2,
      status: "sent",
    });

    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      force: true,
      overrideDryRun: true,
    });

    expect(result.sent).toBe(true);
    expect(insertLeadMessage).not.toHaveBeenCalled();
    expect(updateLeadMessageAttempt).toHaveBeenCalledWith(
      expect.anything(),
      55,
      expect.objectContaining({ status: "sent" })
    );
  });

  it("attempts at or above 5 returns too_many_attempts", async () => {
    getLeadMessageByIdempotency.mockResolvedValue({
      id: 77,
      status: "failed",
      attempts: 5,
    });
    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: false }),
      origin: "https://example.com",
      force: true,
    });
    expect(result.reasons).toEqual(["too_many_attempts"]);
    expect(sendResendEmail).not.toHaveBeenCalled();
    expect(insertLeadMessage).not.toHaveBeenCalled();
    expect(updateLeadMessageAttempt).not.toHaveBeenCalled();
  });

  it("failed retry that fails again updates the same row (no insert)", async () => {
    getLeadMessageByIdempotency.mockResolvedValue({
      id: 42,
      status: "failed",
      attempts: 2,
    });
    sendResendEmail.mockResolvedValue({ sent: false, reason: "rate_limited" });
    updateLeadMessageAttempt.mockResolvedValue({
      id: 42,
      attempts: 3,
      status: "failed",
    });

    const result = await sendLeadOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: false }),
      origin: "https://example.com",
      force: true,
    });

    expect(result.sent).toBe(false);
    expect(result.reasons).toContain("rate_limited");
    expect(insertLeadMessage).not.toHaveBeenCalled();
    expect(updateLeadMessageAttempt).toHaveBeenCalledTimes(1);
  });
});
