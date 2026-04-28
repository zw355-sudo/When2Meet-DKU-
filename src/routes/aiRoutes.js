const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const env = require("../config/env");
const { query } = require("../config/db");
const { AppError } = require("../utils/errors");

const router = express.Router();

const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid ISO datetime",
});
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date, expected YYYY-MM-DD");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

const DEFAULT_IMAGE_PROMPT = `
You are a DKU timetable extraction assistant.
Read the screenshot and return ONLY valid JSON with this exact shape:
{
  "events": [
    {
      "title": "string",
      "description": "string|null",
      "location": "string|null",
      "startTime": "YYYY-MM-DDTHH:mm:ss+08:00",
      "endTime": "YYYY-MM-DDTHH:mm:ss+08:00",
      "eventType": "busy",
      "isRecurring": true,
      "recurrenceRule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=YYYYMMDDT235959Z|null",
      "recurrenceStartDate": "YYYY-MM-DD|null",
      "recurrenceEndDate": "YYYY-MM-DD|null",
      "source": "ai_screenshot"
    }
  ],
  "notes": ["string"]
}

Rules:
0) eventType: use "busy" for classes, sleep, rest, and any time the user cannot be scheduled; use "available" ONLY for explicitly free/bookable slots (rare in timetables).
1) Extract only class/busy time blocks you are confident about.
2) If the timetable appears weekly, set isRecurring=true and infer BYDAY.
3) Use Asia/Shanghai timezone (+08:00) for datetime output.
4) If some fields are unclear, keep event with best-known fields and explain uncertainty in notes.
5) Do not output markdown or explanations. Output JSON only.
`.trim();

const TEXT_PARSE_SYSTEM = `
You are a calendar assistant for a university scheduling app. Output ONLY valid JSON: {"events":[...],"notes":[...]}.

EVENTTYPE SEMANTICS (critical — read before choosing busy vs available):
- "busy" = user is NOT available to be scheduled (classes, sleep, rest, "can't get up", "起不来", "没空", "不要约我", blocking time). Default to "busy" whenever the user expresses unavailability or passive downtime.
- "available" = user explicitly marks positive FREE windows for others to book (e.g. "周三下午我专门空出来可约"). NEVER use "available" for sleep, nightly rest, or phrases like "晚上10点到早上9点休息/睡觉" — those windows are UNAVAILABLE → MUST be "busy" with a clear title (e.g. "夜间休息/睡眠").

1) Scheduling intent: If the user describes blocking time, sleep, rest, "9点前起不来", recurring rules, or anything calendar-like—even vague Chinese—you MUST output concrete "events". Never notes-only unless pure small talk with zero scheduling intent.

2) Each event needs: title, startTime, endTime (ISO 8601 with numeric timezone offset, e.g. +08:00), eventType ("busy" or "available"), isRecurring (boolean), recurrenceRule (RRULE string or null), recurrenceStartDate (YYYY-MM-DD or null), recurrenceEndDate (YYYY-MM-DD or null), description (string or null), location (string or null), source ("ai_conversation").

3) "notes" is for brief caveats only; do not use notes to replace missing events when the user wants schedule changes.

4) Optional "User busy calendar excerpt" block: lines look like "title | start ISO -> end ISO | RECUR ...".
   A) If the user names ONE specific course only (e.g. only PHYSEDU / 体育): match only lines whose title contains that token (case-insensitive substring); for each matched class block add one rest busy starting at that class endTime for the requested duration.
   B) If the user says 每节课后 / 每门课课后 / after every class / each class without restricting to one named course: treat EVERY distinct class-like line in the excerpt as a separate class (different title OR different time pattern). For EACH such line, emit one follow-up busy rest block from that class's endTime. Do NOT output rest for only one subject (e.g. only PE) unless the user explicitly mentioned only that subject.
   C) For recurring classes, mirror BYDAY / RRULE so rest repeats on the same weekdays when possible.

5) If the excerpt is empty or no lines qualify, still output placeholder "busy" events plus "notes" explaining what to add to the calendar.

6) Chinese / colloquial → concrete busy blocks (examples, adapt dates to timezone):
- "9点前起不来" / "早上九点前都没空" → recurring DAILY (or Mon–Sun) "busy" from local 00:00 to 09:00, title like "早晨不可安排(起不来)".
- "晚上10点到早上9点休息/睡觉" → "busy" (NOT available). Prefer TWO recurring daily "busy" events if simpler: (A) 22:00→23:59 same calendar day, (B) 00:00→09:00 same calendar day; both FREQ=DAILY (or FREQ=WEEKLY with all BYDAY). Alternatively one overnight "busy" from day D 22:00 to day D+1 09:00 with FREQ=DAILY if you can express valid ISO datetimes with endTime strictly after startTime.

7) endTime must be strictly after startTime. No markdown outside JSON.
`.trim();

const aiEventSchema = z
  .object({
    title: z.string().max(255).default(""),
    description: z.string().nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
    eventType: z.enum(["busy", "available"]).default("busy"),
    isRecurring: z.boolean().default(false),
    recurrenceRule: z.string().max(500).nullable().optional(),
    recurrenceStartDate: isoDateSchema.nullable().optional(),
    recurrenceEndDate: isoDateSchema.nullable().optional(),
    source: z.enum(["ai_screenshot", "ai_conversation"]).default("ai_screenshot"),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: "endTime must be later than startTime",
    path: ["endTime"],
  });

const aiResultSchema = z.object({
  events: z.array(aiEventSchema).default([]),
  notes: z.array(z.string()).default([]),
});

function toNullableString(value, maxLen) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function isValidDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizeDateOnly(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function asTrimmedString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function normalizeEvent(rawEvent, source) {
  if (!rawEvent || typeof rawEvent !== "object") return null;
  const startTime = asTrimmedString(rawEvent.startTime);
  const endTime = asTrimmedString(rawEvent.endTime);
  if (!isValidDateTime(startTime) || !isValidDateTime(endTime)) return null;
  if (new Date(endTime) <= new Date(startTime)) return null;

  const eventType = rawEvent.eventType === "available" ? "available" : "busy";
  const isRecurring = Boolean(rawEvent.isRecurring);

  return {
    title: toNullableString(rawEvent.title, 255) || "Imported schedule",
    description: toNullableString(rawEvent.description, 5000),
    location: toNullableString(rawEvent.location, 255),
    startTime,
    endTime,
    eventType,
    isRecurring,
    recurrenceRule: (() => {
      const s = asTrimmedString(rawEvent.recurrenceRule);
      if (!s || s === "null") return null;
      return s.slice(0, 500);
    })(),
    recurrenceStartDate: normalizeDateOnly(
      rawEvent.recurrenceStartDate == null || String(rawEvent.recurrenceStartDate).trim() === "null"
        ? null
        : rawEvent.recurrenceStartDate
    ),
    recurrenceEndDate: normalizeDateOnly(
      rawEvent.recurrenceEndDate == null || String(rawEvent.recurrenceEndDate).trim() === "null"
        ? null
        : rawEvent.recurrenceEndDate
    ),
    source,
  };
}

function stripMarkdownJsonFence(text) {
  let t = text.trim();
  const fence = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/im;
  const m = t.match(fence);
  if (m) return m[1].trim();
  if (t.startsWith("```json")) t = t.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "");
  else if (t.startsWith("```")) t = t.replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "");
  return t.trim();
}

function extractJson(text) {
  const cleaned = stripMarkdownJsonFence(String(text || ""));
  if (!cleaned) throw new Error("Empty model output");

  try {
    return JSON.parse(cleaned);
  } catch (_first) {
    const start = cleaned.indexOf("{");
    if (start < 0) throw new Error("No JSON object found in output");

    let depth = 0;
    let end = -1;
    for (let i = start; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_second) {
        // try trimming to last } for slightly broken trailing text
        const last = cleaned.lastIndexOf("}");
        if (last > start) return JSON.parse(cleaned.slice(start, last + 1));
      }
    }
    throw new Error("Model did not return valid JSON");
  }
}

function coerceNotes(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).filter((s) => s.trim() !== "");
  }
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return [String(value)];
}

function getOllamaAssistantText(result) {
  const msg = result?.message;
  if (!msg) return "";
  const { content } = msg;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

const BUSY_CONTEXT_MAX_CHARS = 14000;
const inFlightAiParseByUser = new Map();

async function buildBusyCalendarExcerpt(userId) {
  try {
    const rows = await query(
      `SELECT title,
              start_time AS startTime,
              end_time AS endTime,
              is_recurring AS isRecurring,
              recurrence_rule AS recurrenceRule
       FROM user_calendar_events
       WHERE user_id = ? AND event_type = 'busy'
       ORDER BY start_time ASC
       LIMIT 120`,
      [userId]
    );
    if (!rows.length) return "";
    const head =
      "--- User busy calendar excerpt (title | start -> end | optional RECUR) ---\n";
    const lines = [];
    for (const r of rows) {
      const st = new Date(r.startTime).toISOString();
      const en = new Date(r.endTime).toISOString();
      let rec = "";
      if (r.isRecurring) {
        const rule = r.recurrenceRule ? String(r.recurrenceRule).slice(0, 400) : "";
        rec = rule ? ` | RECUR ${rule}` : " | RECUR (yes)";
      }
      const title = (r.title || "(no title)").replace(/\s+/g, " ").trim();
      lines.push(`${title} | ${st} -> ${en}${rec}`);
    }
    let body = lines.join("\n");
    if (head.length + body.length > BUSY_CONTEXT_MAX_CHARS) {
      body = `${body.slice(0, BUSY_CONTEXT_MAX_CHARS - head.length - 30)}\n... (truncated)`;
    }
    return `${head}${body}`;
  } catch (_e) {
    return "";
  }
}

function parseOllamaScheduleResult(rawContent, eventSource) {
  const preview = String(rawContent || "").slice(0, 1200);
  try {
    const parsed = extractJson(rawContent);
    const rawEvents = Array.isArray(parsed?.events) ? parsed.events : [];
    const normalizedEvents = rawEvents.map((event) => normalizeEvent(event, eventSource)).filter(Boolean);
    const notes = coerceNotes(parsed?.notes);
    const safe = aiResultSchema.safeParse({ events: normalizedEvents, notes });
    if (!safe.success) {
      throw new Error(safe.error?.message || "Schema validation failed after normalization");
    }
    return safe.data;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AppError(
      502,
      `Ollama output could not be parsed as schedule JSON. ${reason}. If this persists, try OLLAMA_VISION_FORMAT_JSON=false (default) or increase OLLAMA_NUM_PREDICT_VISION. Raw preview: ${preview}`
    );
  }
}

async function callOllama({ messages, formatJson = true, numPredict = 2048 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ollamaTimeoutMs);

  try {
    const body = {
      model: env.ollamaModel,
      stream: false,
      options: {
        temperature: 0,
        num_predict: numPredict,
      },
      messages,
    };
    if (formatJson) body.format = "json";
    const triedUrls = [];
    const candidates = [env.ollamaBaseUrl];
    if (env.ollamaBaseUrl.includes("127.0.0.1")) {
      candidates.push(env.ollamaBaseUrl.replace("127.0.0.1", "localhost"));
    } else if (env.ollamaBaseUrl.includes("localhost")) {
      candidates.push(env.ollamaBaseUrl.replace("localhost", "127.0.0.1"));
    }

    let lastNetworkError = null;
    for (const baseUrl of [...new Set(candidates)]) {
      const url = `${baseUrl}/api/chat`;
      triedUrls.push(url);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new AppError(502, `Ollama API failed: ${response.status} ${text}`);
        }
        return response.json();
      } catch (error) {
        if (error instanceof AppError) throw error;
        lastNetworkError = error;
      }
    }
    throw lastNetworkError || new Error("Unknown Ollama network error");
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError(
        504,
        `Ollama timeout after ${env.ollamaTimeoutMs}ms. Try a smaller/clearer image or increase OLLAMA_TIMEOUT_MS.`
      );
    }
    if (error instanceof AppError) throw error;
    const causeCode = error?.cause?.code || error?.code;
    const causePart = causeCode ? ` (${causeCode})` : "";
    throw new AppError(
      502,
      `Ollama request failed: ${error.message}${causePart}. Check Ollama service and OLLAMA_BASE_URL.`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function saveEvents(userId, events) {
  let inserted = 0;
  function deriveDateOnly(dateTime) {
    return new Date(dateTime).toISOString().slice(0, 10);
  }

  for (const event of events) {
    const recurrenceStartDate =
      event.recurrenceStartDate !== undefined
        ? event.recurrenceStartDate
        : event.isRecurring
          ? deriveDateOnly(event.startTime)
          : null;
    const recurrenceEndDate =
      event.recurrenceEndDate !== undefined ? event.recurrenceEndDate : null;

    await query(
      `INSERT INTO user_calendar_events
       (user_id, title, description, location, start_time, end_time, event_type, is_recurring, recurrence_rule, recurrence_start_date, recurrence_end_date, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        event.title,
        event.description || null,
        event.location || null,
        new Date(event.startTime),
        new Date(event.endTime),
        event.eventType,
        event.isRecurring ? 1 : 0,
        event.recurrenceRule || null,
        recurrenceStartDate || null,
        recurrenceEndDate || null,
        event.source,
      ]
    );
    inserted += 1;
  }
  return inserted;
}

async function withAiParseLock(userId, kind, fn) {
  const lock = inFlightAiParseByUser.get(userId);
  if (lock) {
    const waitingSec = Math.max(1, Math.floor((Date.now() - lock.startedAt) / 1000));
    throw new AppError(
      429,
      `Another AI parsing request is running (${lock.kind}, ${waitingSec}s). Please wait for it to finish before retrying.`
    );
  }

  inFlightAiParseByUser.set(userId, { kind, startedAt: Date.now() });
  try {
    return await fn();
  } finally {
    inFlightAiParseByUser.delete(userId);
  }
}

router.post("/ai/parse-schedule-image", upload.single("image"), async (req, res, next) => {
  try {
    return await withAiParseLock(req.auth.userId, "image", async () => {
      if (!req.file) {
        return res.status(400).json({ message: "Missing image, use form-data field: image" });
      }

      const save = String(req.body.save || "false").toLowerCase() === "true";
      const userPrompt = req.body.prompt || DEFAULT_IMAGE_PROMPT;
      const timezone = req.body.timezone || "Asia/Shanghai";

      const imageBase64 = req.file.buffer.toString("base64");
      const result = await callOllama({
        formatJson: env.ollamaVisionFormatJson,
        numPredict: env.ollamaNumPredictVision,
        messages: [
          {
            role: "system",
            content:
              "You are a schedule extraction assistant. Return ONLY valid JSON with shape: {\"events\":[...],\"notes\":[...]}." +
              "Each event must include title,startTime,endTime,eventType,isRecurring,recurrenceRule,recurrenceStartDate,recurrenceEndDate,description,location,source." +
              "Use ISO datetime with timezone offset. source must be ai_screenshot.",
          },
          {
            role: "user",
            content: `Timezone: ${timezone}\n${userPrompt}`,
            images: [imageBase64],
          },
        ],
      });

      const rawContent = getOllamaAssistantText(result);
      if (!rawContent.trim()) {
        throw new AppError(
          502,
          "Ollama returned empty assistant text. Check model name and vision support; try OLLAMA_VISION_FORMAT_JSON=true if your stack requires JSON mode."
        );
      }
      const parsed = parseOllamaScheduleResult(rawContent, "ai_screenshot");
      const normalized = parsed.events.map((event) => ({ ...event, source: "ai_screenshot" }));

      const inserted = save ? await saveEvents(req.auth.userId, normalized) : 0;

      return res.json({
        events: normalized,
        notes: parsed.notes,
        saved: save,
        inserted,
      });
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("AI image parse failed:", error);
    }
    return next(error);
  }
});

router.post("/ai/parse-schedule-text", async (req, res, next) => {
  try {
    return await withAiParseLock(req.auth.userId, "text", async () => {
      const schema = z.object({
        prompt: z.string().min(1),
        timezone: z.string().default("Asia/Shanghai"),
        save: z.boolean().optional().default(false),
        includeCalendarContext: z.boolean().optional().default(false),
      });
      const payload = schema.parse(req.body);

      let userContent = `Timezone: ${payload.timezone}\n\nUser request:\n${payload.prompt}`;
      if (payload.includeCalendarContext) {
        const excerpt = await buildBusyCalendarExcerpt(req.auth.userId);
        if (excerpt) userContent += `\n\n${excerpt}`;
      }

      const result = await callOllama({
        formatJson: true,
        numPredict: env.ollamaNumPredictText,
        messages: [
          {
            role: "system",
            content: TEXT_PARSE_SYSTEM,
          },
          {
            role: "user",
            content: userContent,
          },
        ],
      });

      const rawContent = getOllamaAssistantText(result);
      if (!rawContent.trim()) {
        throw new AppError(502, "Ollama returned empty assistant text for text parse.");
      }
      const parsed = parseOllamaScheduleResult(rawContent, "ai_conversation");
      const normalized = parsed.events.map((event) => ({ ...event, source: "ai_conversation" }));
      const inserted = payload.save ? await saveEvents(req.auth.userId, normalized) : 0;

      return res.json({
        events: normalized,
        notes: parsed.notes,
        saved: payload.save,
        inserted,
      });
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("AI text parse failed:", error);
    }
    return next(error);
  }
});

module.exports = router;
