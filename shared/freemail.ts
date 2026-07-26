/** Freemail / consumer mailbox domains — not valid for PECR corporate auto-send. */

export const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "btinternet.com",
  "sky.com",
  "mail.com",
  "gmx.com",
  "gmx.co.uk",
]);

export function emailDomain(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return null;
  return email.trim().toLowerCase().slice(at + 1);
}

export function isFreemail(email: string): boolean {
  const domain = emailDomain(email);
  return Boolean(domain && FREEMAIL_DOMAINS.has(domain));
}
