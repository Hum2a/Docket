import type { Application, Status } from "../shared/schema";
import { APP_ORIGIN } from "../shared/appOrigin";
import { escapeHtml } from "./email";

export { APP_ORIGIN };
export const APP_SETTINGS_URL = `${APP_ORIGIN}/settings`;

const STATUS_STYLE: Record<
  Status,
  { bg: string; fg: string; border: string; label: string }
> = {
  wishlist: { bg: "#eef1f5", fg: "#3d4a5c", border: "#d5dde8", label: "Wishlist" },
  applied: { bg: "#e8f1fb", fg: "#1e4a7a", border: "#c5daf0", label: "Applied" },
  interview: { bg: "#efeaf8", fg: "#5b3d8a", border: "#d8ccee", label: "Interview" },
  offer: { bg: "#e8f6ee", fg: "#0c5c48", border: "#b8e0c8", label: "Offer" },
  rejected: { bg: "#fcecef", fg: "#8f1f2f", border: "#f0c4cc", label: "Rejected" },
};

export function statusLabel(status: Status): string {
  return STATUS_STYLE[status]?.label ?? status;
}

export function statusBadge(status: Status): string {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.wishlist;
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:0.01em;background:${s.bg};color:${s.fg};border:1px solid ${s.border}">${escapeHtml(s.label)}</span>`;
}

function detailRow(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:10px 14px;width:120px;color:#5a6578;font-size:13px;vertical-align:top;border-bottom:1px solid #e8edf3">${escapeHtml(label)}</td>
    <td style="padding:10px 14px;color:#1a2332;font-size:14px;font-weight:500;border-bottom:1px solid #e8edf3">${valueHtml}</td>
  </tr>`;
}

function plainRow(label: string, value: string | null | undefined): string {
  if (value == null || String(value).trim() === "") return "";
  return `${label}: ${value}\n`;
}

export function applicationDetailTable(
  app: Application,
  opts?: { previousStatus?: Status }
): string {
  const rows: string[] = [
    detailRow("Company", escapeHtml(app.company)),
    detailRow("Position", escapeHtml(app.roleTitle)),
    detailRow("Industry", escapeHtml(app.industry)),
  ];

  if (opts?.previousStatus) {
    rows.push(
      detailRow(
        "Status",
        `${statusBadge(opts.previousStatus)} <span style="color:#5a6578;margin:0 6px">→</span> ${statusBadge(app.status)}`
      )
    );
  } else {
    rows.push(detailRow("Status", statusBadge(app.status)));
  }

  if (app.location?.trim()) rows.push(detailRow("Location", escapeHtml(app.location)));
  if (app.salaryRange?.trim()) rows.push(detailRow("Salary", escapeHtml(app.salaryRange)));
  if (app.source?.trim()) rows.push(detailRow("Source", escapeHtml(app.source)));
  if (app.appliedDate?.trim()) rows.push(detailRow("Applied", escapeHtml(app.appliedDate)));
  if (app.jobUrl?.trim()) {
    const safe = escapeHtml(app.jobUrl);
    rows.push(
      detailRow(
        "Job link",
        `<a href="${safe}" style="color:#0f6e56;text-decoration:underline;word-break:break-all">${safe}</a>`
      )
    );
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #d5dde8;border-radius:10px;overflow:hidden">${rows.join("")}</table>`;
}

export function applicationPlainText(
  app: Application,
  opts?: { previousStatus?: Status }
): string {
  let text = "";
  text += plainRow("Company", app.company);
  text += plainRow("Position", app.roleTitle);
  text += plainRow("Industry", app.industry);
  if (opts?.previousStatus) {
    text += `Status: ${statusLabel(opts.previousStatus)} → ${statusLabel(app.status)}\n`;
  } else {
    text += plainRow("Status", statusLabel(app.status));
  }
  text += plainRow("Location", app.location);
  text += plainRow("Salary", app.salaryRange);
  text += plainRow("Source", app.source);
  text += plainRow("Applied", app.appliedDate);
  text += plainRow("Job link", app.jobUrl);
  if (app.id > 0) text += `\nView: ${APP_ORIGIN}/apps/${app.id}\n`;
  return text.trim();
}

export type BuiltEmail = {
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

function emailShell(opts: {
  accent: string;
  eyebrow: string;
  title: string;
  intro: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  whyLine: string;
}): string {
  const cta =
    opts.ctaLabel && opts.ctaHref
      ? `<tr><td style="padding:20px 28px 8px">
          <a href="${escapeHtml(opts.ctaHref)}" style="display:inline-block;background:#0f6e56;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600">
            ${escapeHtml(opts.ctaLabel)}
          </a>
        </td></tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f6f9">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
    ${escapeHtml(opts.intro)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f9;padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d5dde8;border-radius:12px;overflow:hidden">
          <tr>
            <td style="height:4px;background:${opts.accent};font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:22px 28px 0;font-family:Georgia,'Times New Roman',serif">
              <p style="margin:0 0 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${opts.accent}">
                ${escapeHtml(opts.eyebrow)}
              </p>
              <h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;color:#1a2332;font-weight:600">
                ${escapeHtml(opts.title)}
              </h1>
              <p style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#5a6578">
                ${opts.intro}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px">${opts.bodyHtml}</td>
          </tr>
          ${cta}
          <tr>
            <td style="padding:22px 28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.55;color:#5a6578;border-top:1px solid #e8edf3;margin-top:16px">
              <p style="margin:16px 0 0">
                ${escapeHtml(opts.whyLine)}
                You can update notification recipients in
                <a href="${APP_SETTINGS_URL}" style="color:#0f6e56">Docket Settings</a>.
              </p>
              <p style="margin:10px 0 0;color:#8a94a6">
                Docket · <a href="${APP_ORIGIN}" style="color:#0f6e56;text-decoration:none">${APP_ORIGIN.replace("https://", "")}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function plainFooter(whyLine: string): string {
  return `\n\n—\n${whyLine}\nManage recipients: ${APP_SETTINGS_URL}\nDocket · ${APP_ORIGIN}\n`;
}

export function buildCreatedEmail(app: Application): BuiltEmail {
  const subject = `Docket: added ${app.company} · ${app.roleTitle}`;
  const intro = `A new application was added to your pipeline.`;
  const why = "You're receiving this because Docket notify emails are enabled for your account.";

  return {
    subject,
    html: emailShell({
      accent: "#0f6e56",
      eyebrow: "New application",
      title: `${app.company}`,
      intro: `${escapeHtml(intro)} <span style="display:inline-block;margin-left:4px">${statusBadge(app.status)}</span>`,
      bodyHtml: applicationDetailTable(app),
      ctaLabel: app.id > 0 ? "Open in Docket" : undefined,
      ctaHref: app.id > 0 ? `${APP_ORIGIN}/apps/${app.id}` : undefined,
      whyLine: why,
    }),
    text: `Docket — new application\n\n${intro}\n\n${applicationPlainText(app)}${plainFooter(why)}`,
  };
}

export function buildStatusChangedEmail(
  app: Application,
  previousStatus: Status
): BuiltEmail {
  const subject = `Docket: ${app.company} · ${statusLabel(previousStatus)} → ${statusLabel(app.status)}`;
  const intro = `${escapeHtml(app.company)} moved from ${escapeHtml(statusLabel(previousStatus))} to ${escapeHtml(statusLabel(app.status))}.`;
  const why = "You're receiving this because Docket notify emails are enabled for your account.";
  const accent = STATUS_STYLE[app.status]?.fg ?? "#0f6e56";

  return {
    subject,
    html: emailShell({
      accent,
      eyebrow: "Status updated",
      title: app.roleTitle,
      intro,
      bodyHtml: applicationDetailTable(app, { previousStatus }),
      ctaLabel: app.id > 0 ? "Open in Docket" : undefined,
      ctaHref: app.id > 0 ? `${APP_ORIGIN}/apps/${app.id}` : undefined,
      whyLine: why,
    }),
    text: `Docket — status updated\n\n${app.company} moved from ${statusLabel(previousStatus)} to ${statusLabel(app.status)}.\n\n${applicationPlainText(app, { previousStatus })}${plainFooter(why)}`,
  };
}

export function buildTestEmail(): BuiltEmail {
  const sample: Application = {
    id: 0,
    company: "Acme Corp",
    roleTitle: "Software Engineer",
    industry: "Technology",
    location: "London",
    jobUrl: "https://example.com/jobs/123",
    status: "interview",
    appliedDate: "2026-07-01",
    salaryRange: "£70–85k",
    source: "LinkedIn",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const why = "This is a test message from Docket Settings to verify Resend delivery.";

  const html = emailShell({
    accent: "#0f6e56",
    eyebrow: "Test email",
    title: "Resend is working",
    intro: "If you received this, create and status alerts can reach your inbox.",
    bodyHtml: `
      <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#5a6578;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.04em">Sample — new application</p>
      ${applicationDetailTable({ ...sample, status: "wishlist" })}
      <div style="height:20px"></div>
      <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#5a6578;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.04em">Sample — status change</p>
      ${applicationDetailTable(sample, { previousStatus: "applied" })}
    `,
    ctaLabel: "Open Docket Settings",
    ctaHref: APP_SETTINGS_URL,
    whyLine: why,
  });

  return {
    subject: "Docket: test email (delivery check)",
    html,
    text: `Docket — test email\n\nIf you received this, create and status alerts can reach your inbox.\n\n--- Sample: new application ---\n${applicationPlainText({ ...sample, status: "wishlist" })}\n\n--- Sample: status change ---\n${applicationPlainText(sample, { previousStatus: "applied" })}${plainFooter(why)}`,
  };
}

export function buildDigestEmail(
  items: { dueDate: string; company: string; roleTitle: string; message: string; applicationId?: number }[]
): BuiltEmail {
  const subject = `Docket: ${items.length} reminder${items.length === 1 ? "" : "s"} due soon`;
  const why =
    "You're receiving this daily digest because Docket reminder emails are enabled. Manage recipients in Settings.";
  const unsubscribeUrl = APP_SETTINGS_URL;

  const rows = items
    .map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      return `<tr style="background:${bg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;color:#0f6e56;font-weight:600;white-space:nowrap;font-size:13px">${escapeHtml(r.dueDate)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;color:#1a2332;font-size:13px"><strong>${escapeHtml(r.company)}</strong><br/><span style="color:#5a6578">${escapeHtml(r.roleTitle)}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;color:#1a2332;font-size:13px">${escapeHtml(r.message)}</td>
      </tr>`;
    })
    .join("");

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #d5dde8;border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
      <thead>
        <tr style="background:#eef6f3">
          <th align="left" style="padding:10px 12px;font-size:12px;color:#0f6e56;text-transform:uppercase;letter-spacing:0.04em">Due</th>
          <th align="left" style="padding:10px 12px;font-size:12px;color:#0f6e56;text-transform:uppercase;letter-spacing:0.04em">Application</th>
          <th align="left" style="padding:10px 12px;font-size:12px;color:#0f6e56;text-transform:uppercase;letter-spacing:0.04em">Reminder</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  const textLines = items
    .map((r) => `- ${r.dueDate} · ${r.company} (${r.roleTitle}): ${r.message}`)
    .join("\n");

  return {
    subject,
    html: emailShell({
      accent: "#b45309",
      eyebrow: "Reminder digest",
      title: `${items.length} due within 3 days`,
      intro: "Incomplete reminders that need attention soon.",
      bodyHtml,
      ctaLabel: "Open Docket",
      ctaHref: APP_ORIGIN,
      whyLine: why,
    }),
    text: `Docket — reminders due soon\n\n${items.length} reminder(s) due within 3 days.\n\n${textLines}${plainFooter(why)}`,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
