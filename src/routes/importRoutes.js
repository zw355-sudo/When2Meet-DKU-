const express = require("express");
const multer = require("multer");
const ical = require("node-ical");
const { query } = require("../config/db");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function toNullableString(value, maxLen) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

/**
 * node-ical stores SUMMARY/DESCRIPTION/LOCATION as a string when there are no
 * extra params; with LANGUAGE=… or ALTREP=… they become { val: string, params }.
 * Duplicate properties become an array of those shapes. Coercing the object
 * with String() yields "[object Object]".
 */
function icsTextToPlain(value, maxLen, joiner = "\n") {
  function inner(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object" && v !== null && Object.prototype.hasOwnProperty.call(v, "val")) {
      return inner(v.val);
    }
    if (Array.isArray(v)) {
      return v
        .map(inner)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(joiner);
    }
    return "";
  }
  const out = inner(value).trim();
  if (!out) return null;
  return out.slice(0, maxLen);
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDateOnly(dateLike) {
  const date = toDateOrNull(dateLike);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function extractUntilDateFromRRule(rruleText) {
  if (!rruleText) return null;
  const match = String(rruleText).match(/UNTIL=([0-9TZ]+)/);
  if (!match) return null;
  const raw = match[1];

  // Examples:
  // 20251231T235959Z, 20251231T235959, 20251231
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{8}T\d{6}Z?$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return null;
}

router.post("/me/calendar-events/import-ics", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Missing ICS file, use form-data field: file" });
    }

    let parsed;
    try {
      parsed = ical.parseICS(req.file.buffer.toString("utf-8"));
    } catch (_error) {
      return res.status(400).json({ message: "Invalid ICS file format" });
    }
    const vevents = Object.values(parsed).filter((item) => item.type === "VEVENT");
    const overwriteExistingBusy = String(req.body.overwriteExistingBusy || "false").toLowerCase() === "true";
    const checkOnly = String(req.body.checkOnly || "false").toLowerCase() === "true";

    let inserted = 0;
    let skipped = 0;
    let overwritten = 0;
    let conflicts = 0;
    let wouldInsert = 0;
    /** @type {Array<object>} */
    const previewEvents = [];

    function pushPreview(row) {
      if (checkOnly) previewEvents.push(row);
    }

    for (const event of vevents) {
      const start = toDateOrNull(event.start);
      const end = toDateOrNull(event.end) || (start ? new Date(start.getTime() + 60 * 60 * 1000) : null);
      const titleDraft = icsTextToPlain(event.summary, 255, " ") || "Imported event";

      if (!start || !end || end <= start) {
        skipped += 1;
        pushPreview({
          status: "invalid",
          title: titleDraft,
          startTime: null,
          endTime: null,
          location: null,
          description: null,
          isRecurring: false,
          recurrenceRule: null,
          recurrenceStartDate: null,
          recurrenceEndDate: null,
          eventType: "busy",
          reason: "开始/结束时间无效或未解析",
        });
        continue;
      }

      const recurrenceRule = toNullableString(event.rrule, 500);
      const recurrenceStartDate = recurrenceRule ? toDateOnly(start) : null;
      const recurrenceEndDate = recurrenceRule
        ? toDateOnly(event.rrule?.options?.until) || extractUntilDateFromRRule(recurrenceRule)
        : null;
      const title = titleDraft;
      const description = icsTextToPlain(event.description, 20000);
      const location = icsTextToPlain(event.location, 255, " ");

      try {
        const overlapRows = await query(
          `SELECT id
           FROM user_calendar_events
           WHERE user_id = ?
             AND event_type = 'busy'
             AND start_time < ?
             AND end_time > ?`,
          [req.auth.userId, end, start]
        );

        if (overlapRows.length > 0) {
          conflicts += 1;
          if (checkOnly) {
            pushPreview({
              status: "conflict",
              title,
              startTime: start.toISOString(),
              endTime: end.toISOString(),
              location,
              description,
              isRecurring: Boolean(recurrenceRule),
              recurrenceRule,
              recurrenceStartDate,
              recurrenceEndDate,
              eventType: "busy",
              reason: "与现有 busy 时间段重叠；保存时若选择覆盖将替换冲突项",
            });
            continue;
          }
          if (overwriteExistingBusy) {
            const ids = overlapRows.map((row) => row.id);
            if (ids.length > 0) {
              const placeholders = ids.map(() => "?").join(",");
              const result = await query(
                `DELETE FROM user_calendar_events
                 WHERE user_id = ?
                   AND id IN (${placeholders})`,
                [req.auth.userId, ...ids]
              );
              overwritten += result.affectedRows || 0;
            }
          } else {
            skipped += 1;
            continue;
          }
        }

        if (checkOnly) {
          wouldInsert += 1;
          pushPreview({
            status: "ready",
            title,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            location,
            description,
            isRecurring: Boolean(recurrenceRule),
            recurrenceRule,
            recurrenceStartDate,
            recurrenceEndDate,
            eventType: "busy",
          });
          continue;
        }

        await query(
          `INSERT INTO user_calendar_events
           (user_id, title, description, location, start_time, end_time, event_type, is_recurring, recurrence_rule, recurrence_start_date, recurrence_end_date, source)
           VALUES (?, ?, ?, ?, ?, ?, 'busy', ?, ?, ?, ?, 'ics_import')`,
          [
            req.auth.userId,
            title,
            description,
            location,
            start,
            end,
            recurrenceRule ? 1 : 0,
            recurrenceRule,
            recurrenceStartDate,
            recurrenceEndDate,
          ]
        );
        inserted += 1;
      } catch (_insertError) {
        skipped += 1;
      }
    }

    return res.status(201).json({
      message: checkOnly ? "ICS check completed" : "ICS import completed",
      inserted,
      skipped,
      conflicts,
      overwritten,
      wouldInsert,
      totalParsed: vevents.length,
      overwriteExistingBusy,
      checkOnly,
      previewEvents: checkOnly ? previewEvents : [],
    });
  } catch (error) {
    console.error("ICS import failed:", error);
    return next(error);
  }
});

module.exports = router;
