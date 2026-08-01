import crypto from 'node:crypto';

/**
 * Optional HMAC tokens for the links in the outreach email.
 *
 * The webhook URL is visible in the page source of any static site, so without
 * this anyone can post arbitrary vendor_ids into the tracker. When
 * LINK_SIGNING_SECRET is set, each vendor's link carries a token derived from
 * their vendor_id and only signed links are accepted. Leaving the secret unset
 * disables the check entirely.
 */

const TOKEN_BYTES = 16;

export function signVendorId(vendorId, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(String(vendorId))
    .digest('base64url')
    .slice(0, Math.ceil((TOKEN_BYTES * 8) / 6));
}

export function verifyVendorToken(vendorId, token, secret) {
  if (!secret) return true;
  if (typeof token !== 'string' || !token) return false;

  const expected = Buffer.from(signVendorId(vendorId, secret));
  const provided = Buffer.from(token);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/** Constant-time comparison for the admin token on /api/export. */
export function matchesSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hashIp(ip, salt) {
  if (!ip) return null;
  // Stored instead of the raw address so the events table holds no PII while
  // still supporting per-client rate limiting.
  return crypto.createHash('sha256').update(`${salt || ''}:${ip}`).digest('hex').slice(0, 32);
}
