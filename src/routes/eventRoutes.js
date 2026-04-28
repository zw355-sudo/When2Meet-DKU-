const express = require("express");
const crypto = require("crypto");
const { query, pool } = require("../config/db");
const { AppError } = require("../utils/errors");
const { createTeamEventSchema, availabilityQuerySchema } = require("../utils/validators");
const { computeCommonAvailability } = require("../services/availabilityService");
const { expandBusyRowsForRange } = require("../services/recurrenceExpandService");

const router = express.Router();

function createSlug() {
  return crypto.randomBytes(8).toString("hex");
}

function normalizeQueryDateTime(value) {
  if (typeof value !== "string") return value;
  // In query strings, '+' is often decoded as space. Convert "... 08:00" back to "...+08:00".
  return value.replace(/ (\d{2}:\d{2})$/, "+$1");
}

async function ensureParticipant(eventId, userId) {
  const existing = await query("SELECT 1 FROM event_participants WHERE event_id=? AND user_id=? LIMIT 1", [
    eventId,
    userId,
  ]);
  if (existing.length === 0) {
    await query("INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)", [eventId, userId]);
  }
}

router.post("/events", async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const payload = createTeamEventSchema.parse(req.body);
    const slug = createSlug();

    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO events (creator_id, title, description, location, slug, available_start, available_end)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.auth.userId,
        payload.title,
        payload.description || null,
        payload.location || null,
        slug,
        new Date(payload.availableStart),
        new Date(payload.availableEnd),
      ]
    );
    await connection.execute("INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)", [
      result.insertId,
      req.auth.userId,
    ]);
    await connection.commit();

    return res.status(201).json({
      id: result.insertId,
      slug,
      shareUrl: `/api/events/${slug}`,
    });
  } catch (error) {
    await connection.rollback();
    if (error && error.code === "ER_DUP_ENTRY") return next(new AppError(409, "Slug conflict, retry"));
    return next(error);
  } finally {
    connection.release();
  }
});

router.get("/events/:slug", async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT
        e.id, e.title, e.description, e.location, e.slug, e.available_start AS availableStart, e.available_end AS availableEnd, e.status,
        e.creator_id AS creatorId, e.created_at AS createdAt,
        u.display_name AS creatorDisplayName
      FROM events e
      JOIN users u ON u.id = e.creator_id
      WHERE e.slug = ?
      LIMIT 1`,
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Event not found" });
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/events/:slug/join", async (req, res, next) => {
  try {
    const eventRows = await query("SELECT id FROM events WHERE slug = ? LIMIT 1", [req.params.slug]);
    if (eventRows.length === 0) return res.status(404).json({ message: "Event not found" });
    await ensureParticipant(eventRows[0].id, req.auth.userId);
    return res.json({ message: "Joined event" });
  } catch (error) {
    return next(error);
  }
});

router.post("/events/:slug/import-my-calendar", async (req, res, next) => {
  try {
    const eventRows = await query("SELECT id FROM events WHERE slug = ? LIMIT 1", [req.params.slug]);
    if (eventRows.length === 0) return res.status(404).json({ message: "Event not found" });
    const eventId = eventRows[0].id;

    await ensureParticipant(eventId, req.auth.userId);
    return res.json({
      message: "Calendar is linked via your user profile, no duplicate import needed",
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/events/:slug/participants", async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, u.username, u.display_name AS displayName, u.major, u.avatar_url AS avatarUrl
       FROM event_participants ep
       JOIN events e ON e.id = ep.event_id
       JOIN users u ON u.id = ep.user_id
       WHERE e.slug = ?
       ORDER BY ep.joined_at ASC`,
      [req.params.slug]
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/events/:slug/common-availability", async (req, res, next) => {
  try {
    const parsedQuery = availabilityQuerySchema.parse({
      ...req.query,
      from: normalizeQueryDateTime(req.query.from),
      to: normalizeQueryDateTime(req.query.to),
    });

    const eventRows = await query(
      "SELECT id, available_start AS availableStart, available_end AS availableEnd FROM events WHERE slug = ? LIMIT 1",
      [req.params.slug]
    );
    if (eventRows.length === 0) return res.status(404).json({ message: "Event not found" });
    const eventId = eventRows[0].id;
    const from = parsedQuery.from || new Date(eventRows[0].availableStart).toISOString();
    const to = parsedQuery.to || new Date(eventRows[0].availableEnd).toISOString();

    const participants = await query("SELECT user_id AS userId FROM event_participants WHERE event_id = ?", [eventId]);
    const busyByUser = [];

    const rangeFromDate = new Date(from).toISOString().slice(0, 10);
    const rangeToDate = new Date(to).toISOString().slice(0, 10);

    for (const p of participants) {
      const busyRows = await query(
        `SELECT start_time, end_time, is_recurring, recurrence_rule, recurrence_start_date, recurrence_end_date
         FROM user_calendar_events
         WHERE user_id = ?
           AND event_type = 'busy'
           AND (
             (is_recurring = 0 AND start_time < ? AND end_time > ?)
             OR
             (
               is_recurring = 1
               AND recurrence_rule IS NOT NULL
               AND TRIM(recurrence_rule) <> ''
               AND (recurrence_end_date IS NULL OR recurrence_end_date >= ?)
               AND (recurrence_start_date IS NULL OR recurrence_start_date <= ?)
             )
           )`,
        [p.userId, new Date(to), new Date(from), rangeFromDate, rangeToDate]
      );
      const expanded = expandBusyRowsForRange(busyRows, from, to);
      busyByUser.push(expanded);
    }

    const slots = computeCommonAvailability({
      rangeStartIso: from,
      rangeEndIso: to,
      participantsBusyEvents: busyByUser,
      durationMinutes: parsedQuery.durationMinutes,
    });

    return res.json({
      participants: participants.length,
      range: { from, to },
      slots,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
