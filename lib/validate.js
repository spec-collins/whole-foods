export const CHOICES = ['template', 'ehalo_self', 'working_session', 'send_docs'];
export const TIMEFRAME_PRESETS = ['this_week', 'next_two_weeks', 'need_more_time'];

const MAX_VENDOR_ID = 128;
const MAX_VENDOR_NAME = 200;
const MAX_LABEL = 300;

/** Trims, collapses whitespace, and strips control characters. */
function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Returns an ISO timestamp when the input is a usable date, else null. */
function timestampOrNull(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  // Guard against clock-skewed or fabricated timestamps far outside the
  // window in which this campaign could plausibly run.
  const now = Date.now();
  if (parsed < now - 365 * 24 * 3600 * 1000 || parsed > now + 24 * 3600 * 1000) return null;
  return new Date(parsed).toISOString();
}

/**
 * Validates one submission from the landing page.
 * Returns { ok: true, value } or { ok: false, error }.
 */
export function validateSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Body must be a JSON object.' };
  }

  const stage = clean(input.stage, 32);
  if (stage !== 'choice' && stage !== 'timeframe') {
    return { ok: false, error: 'stage must be "choice" or "timeframe".' };
  }

  const vendorId = clean(input.vendor_id, MAX_VENDOR_ID) || 'unknown';
  const vendorName = clean(input.vendor_name, MAX_VENDOR_NAME) || null;
  const token = clean(input.token, 128) || null;

  const value = {
    stage,
    vendor_id: vendorId,
    vendor_name: vendorName,
    token,
    choice: null,
    choice_label: null,
    choice_submitted_at: null,
    timeframe: null,
    timeframe_label: null,
    timeframe_submitted_at: null,
  };

  const nowIso = new Date().toISOString();

  if (stage === 'choice') {
    const choice = clean(input.choice, 64);
    if (!CHOICES.includes(choice)) {
      return { ok: false, error: `choice must be one of: ${CHOICES.join(', ')}.` };
    }
    value.choice = choice;
    value.choice_label = clean(input.choice_label, MAX_LABEL) || null;
    value.choice_submitted_at = timestampOrNull(input.submitted_at) || nowIso;
  } else {
    const timeframe = clean(input.timeframe, 64);
    if (!TIMEFRAME_PRESETS.includes(timeframe) && !isIsoDate(timeframe)) {
      return {
        ok: false,
        error: `timeframe must be one of: ${TIMEFRAME_PRESETS.join(', ')}, or a YYYY-MM-DD date.`,
      };
    }
    value.timeframe = timeframe;
    value.timeframe_label = clean(input.timeframe_label, MAX_LABEL) || null;
    value.timeframe_submitted_at = timestampOrNull(input.timeframe_submitted_at) || nowIso;
  }

  return { ok: true, value };
}
