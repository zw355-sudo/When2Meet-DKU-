const { RRule } = require("rrule");

function toMs(value) {
  return new Date(value).getTime();
}

function endOfDayUtc(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function startOfDayUtc(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function clipInterval(startMs, endMs, rangeFromMs, rangeToMs) {
  const clipS = Math.max(startMs, rangeFromMs);
  const clipE = Math.min(endMs, rangeToMs);
  if (clipS >= clipE) return null;
  return { start_time: new Date(clipS), end_time: new Date(clipE) };
}

function expandRecurringRow(row, rangeFromMs, rangeToMs) {
  const rruleRaw = String(row.recurrence_rule || "").replace(/^RRULE:/i, "").trim();
  if (!rruleRaw) return [];

  const durationMs = toMs(row.end_time) - toMs(row.start_time);
  if (durationMs <= 0) return [];

  let options;
  try {
    options = RRule.parseString(rruleRaw);
  } catch (_e) {
    return singleOccurrenceClip(row, rangeFromMs, rangeToMs);
  }

  let rule;
  try {
    rule = new RRule({ ...options, dtstart: new Date(row.start_time) });
  } catch (_e) {
    return singleOccurrenceClip(row, rangeFromMs, rangeToMs);
  }

  let searchFrom = rangeFromMs;
  let searchTo = rangeToMs;

  const recStart = startOfDayUtc(row.recurrence_start_date);
  if (recStart !== null) {
    searchFrom = Math.max(searchFrom, recStart);
  }

  const recEnd = endOfDayUtc(row.recurrence_end_date);
  if (recEnd !== null) {
    searchTo = Math.min(searchTo, recEnd);
  }

  if (searchFrom >= searchTo) return [];

  let occurrences;
  try {
    occurrences = rule.between(new Date(searchFrom), new Date(searchTo), true);
  } catch (_e) {
    return singleOccurrenceClip(row, rangeFromMs, rangeToMs);
  }

  const out = [];
  for (const occ of occurrences) {
    const startMs = occ.getTime();
    const endMs = startMs + durationMs;
    const clipped = clipInterval(startMs, endMs, rangeFromMs, rangeToMs);
    if (clipped) out.push(clipped);
  }
  return out;
}

function singleOccurrenceClip(row, rangeFromMs, rangeToMs) {
  const clipped = clipInterval(toMs(row.start_time), toMs(row.end_time), rangeFromMs, rangeToMs);
  return clipped ? [clipped] : [];
}

/**
 * @param {Array<{start_time: Date|string, end_time: Date|string, is_recurring?: number|boolean, recurrence_rule?: string|null, recurrence_start_date?: string|null, recurrence_end_date?: string|null}>} rows
 * @param {string|Date} rangeFromIso
 * @param {string|Date} rangeToIso
 * @returns {Array<{start_time: Date, end_time: Date}>}
 */
function expandBusyRowsForRange(rows, rangeFromIso, rangeToIso) {
  const rangeFromMs = toMs(rangeFromIso);
  const rangeToMs = toMs(rangeToIso);
  const merged = [];

  for (const row of rows) {
    const isRecurring = Boolean(row.is_recurring);
    if (isRecurring && row.recurrence_rule) {
      merged.push(...expandRecurringRow(row, rangeFromMs, rangeToMs));
    } else {
      const one = clipInterval(toMs(row.start_time), toMs(row.end_time), rangeFromMs, rangeToMs);
      if (one) merged.push(one);
    }
  }

  return merged;
}

module.exports = {
  expandBusyRowsForRange,
};
