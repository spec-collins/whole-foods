const MAX_BODY_BYTES = 8 * 1024;

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Reads and parses a JSON request body.
 *
 * Vercel's Node runtime may have already parsed the body onto req.body, while
 * a plain Node server has not, so both paths are handled. The content type is
 * ignored because the page can send text/plain to sidestep a CORS preflight.
 */
export async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return { ok: true, value: req.body };
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) {
        return { ok: false, error: 'Request body is too large.', status: 413 };
      }
      try {
        return { ok: true, value: JSON.parse(req.body) };
      } catch {
        return { ok: false, error: 'Body is not valid JSON.', status: 400 };
      }
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      return { ok: false, error: 'Request body is too large.', status: 413 };
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return { ok: false, error: 'Request body is empty.', status: 400 };

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'Body is not valid JSON.', status: 400 };
  }
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    // Vercel appends the real client IP last; take the first entry, which is
    // what the client presented, and fall back to the socket address.
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

/** Reads a query param without depending on Vercel's req.query. */
export function getQuery(req) {
  return new URL(req.url || '/', 'http://localhost').searchParams;
}
