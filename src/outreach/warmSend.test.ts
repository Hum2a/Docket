import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, OutreachSettings } from "../../shared/outreach";
import type { Env } from "../schema";

const insertLeadMessage = vi.fn();
const updateLeadMessageAttempt = vi.fn();
const countWarmOutbound = vi.fn();
const getLeadMessageByIdempotency = vi.fn();
const isSuppressed = vi.fn();
const sendResendEmail = vi.fn();
const getInitialOutboundProviderId = vi.fn();
const listDueWarmSends = vi.fn();
const getOutreachSettings = vi.fn();
const getLeadById = vi.fn();

vi.mock("../outreach-db", () => ({
  countWarmOutbound: (...args: unknown[]) => countWarmOutbound(...args),
  getLeadById: (...args: unknown[]) => getLeadById(...args),
  getLeadMessageByIdempotency: (...args: unknown[]) => getLeadMessageByIdempotency(...args),
  getOutreachSettings: (...args: unknown[]) => getOutreachSettings(...args),
  insertLeadMessage: (...args: unknown[]) => insertLeadMessage(...args),
  updateLeadMessageAttempt: (...args: unknown[]) => updateLeadMessageAttempt(...args),
  MAX_MESSAGE_SEND_ATTEMPTS: 5,
  isSuppressed: (...args: unknown[]) => isSuppressed(...args),
  listDueWarmSends: (...args: unknown[]) => listDueWarmSends(...args),
  setWarmSendAt: vi.fn(),
  getInitialOutboundProviderId: (...args: unknown[]) => getInitialOutboundProviderId(...args),
}));

vi.mock("../email", () => ({
  sendResendEmail: (...args: unknown[]) => sendResendEmail(...args),
}));

vi.mock("../db", () => ({
  getSql: () => sql,
}));

const sql = Object.assign(async () => [{ id: 1 }], {
  begin: async () => undefined,
}) as unknown as import("../db").Sql;

const { sendWarmOutreach, runQueuedWarmSends } = await import("./warmSend");

function baseLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 104,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    businessName: "Silver Bikes Motorcycle Training",
    slug: "silverbikes",
    industry: "motorcycle training",
    location: "Havant",
    postcode: null,
    address: null,
    contactName: "Leslie",
    contactEmail: null,
    contactPhone: "07817 836336",
    contactFormUrl: null,
    emailSource: null,
    emailVerified: false,
    websiteUrl: "http://www.silverbiketraining.com",
    hasWebsite: true,
    companiesHouseNumber: null,
    entityType: "sole_trader",
    corporateSubscriber: false,
    chStatus: null,
    incorporatedOn: null,
    audit: {},
    needScore: 8,
    likelihoodScore: 7,
    priorityScore: 7.6,
    scoreReason: null,
    demoUrl: "https://demo.humza-butt.space/silverbikes/",
    demoBuiltAt: null,
    demoExpiresAt: null,
    demoStatus: "ready",
    status: "scored",
    sentAt: null,
    lastTouchAt: null,
    nextFollowupAt: null,
    followupStep: 0,
    repliedAt: null,
    replySentiment: null,
    suppressed: false,
    suppressionReason: null,
    offerAmount: 500,
    source: "manual",
    sourceRef: "silverbiketraining.com",
    reviewReasons: [],
    customSubject: "Silver Bikes demo",
    customBody: "Here's the rebuilt site.",
    observationOverride: null,
    openingHours: null,
    draftUpdatedAt: null,
    consentStatus: "verbal_call",
    consentAt: new Date().toISOString(),
    consentNote: "asked for the link",
    consentEmail: "leslie@silverbiketraining.com",
    warmSendAt: null,
    contactRoute: "phone",
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
    postalAddress: "12 Example Road, Croydon CR0 4JF",
    followupOffsetsDays: [3, 7],
    dryRun: false,
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
    UNSUBSCRIBE_SIGNING_KEY: "unsub-secret-key",
    ...over,
  };
}

describe("sendWarmOutreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSuppressed.mockResolvedValue(false);
    countWarmOutbound.mockResolvedValue(0);
    getLeadMessageByIdempotency.mockResolvedValue(null);
    insertLeadMessage.mockResolvedValue({ id: 50 });
    sendResendEmail.mockResolvedValue({ sent: true, id: "re_1" });
    getInitialOutboundProviderId.mockResolvedValue(null);
  });

  it("sends from the personal domain and logs primary_domain_warm_send", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await sendWarmOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings(),
      origin: "https://docket.humza-butt.space",
    });
    expect(result.sent).toBe(true);
    expect(sendResendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "leslie@silverbiketraining.com",
        from: "Humza Butt <humza@humza-butt.space>",
        disableTracking: true,
      })
    );
    const logged = String(warn.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("primary_domain_warm_send");
    expect(logged).toContain("104");
    warn.mockRestore();
  });

  it("does not send when canWarmSend fails", async () => {
    const result = await sendWarmOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead({ consentStatus: "none", consentEmail: null }),
      settings: baseSettings(),
      origin: "https://example.com",
    });
    expect(result.sent).toBe(false);
    expect(result.reasons).toContain("consent_none");
    expect(sendResendEmail).not.toHaveBeenCalled();
  });

  it("respects settings dryRun unless overrideDryRun", async () => {
    const blocked = await sendWarmOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
    });
    expect(blocked.dryRun).toBe(true);
    expect(sendResendEmail).not.toHaveBeenCalled();

    const live = await sendWarmOutreach({
      sql,
      env: baseEnv(),
      lead: baseLead(),
      settings: baseSettings({ dryRun: true }),
      origin: "https://example.com",
      overrideDryRun: true,
    });
    expect(live.sent).toBe(true);
  });
});

describe("runQueuedWarmSends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSuppressed.mockResolvedValue(false);
    countWarmOutbound.mockResolvedValue(0);
    getLeadMessageByIdempotency.mockResolvedValue(null);
    insertLeadMessage.mockResolvedValue({ id: 51 });
    sendResendEmail.mockResolvedValue({ sent: true, id: "re_2" });
    getInitialOutboundProviderId.mockResolvedValue(null);
  });

  it("re-checks the gate and skips a stale consent without sending", async () => {
    const stale = baseLead({
      consentAt: "2026-01-01T00:00:00.000Z",
    });
    getOutreachSettings.mockResolvedValue(baseSettings());
    listDueWarmSends.mockResolvedValue([stale]);
    await runQueuedWarmSends(baseEnv(), "https://example.com");
    expect(sendResendEmail).not.toHaveBeenCalled();
  });

  it("sends when the gate still passes", async () => {
    const lead = baseLead();
    getOutreachSettings.mockResolvedValue(baseSettings());
    listDueWarmSends.mockResolvedValue([lead]);
    getLeadById.mockResolvedValue(lead);
    await runQueuedWarmSends(baseEnv(), "https://example.com");
    expect(sendResendEmail).toHaveBeenCalled();
  });

  it("does not send when settings.dryRun", async () => {
    getOutreachSettings.mockResolvedValue(baseSettings({ dryRun: true }));
    listDueWarmSends.mockResolvedValue([baseLead()]);
    await runQueuedWarmSends(baseEnv(), "https://example.com");
    expect(sendResendEmail).not.toHaveBeenCalled();
    expect(listDueWarmSends).not.toHaveBeenCalled();
  });
});
