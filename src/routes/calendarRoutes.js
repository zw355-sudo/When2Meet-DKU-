const express = require("express");
const { query } = require("../config/db");
const { calendarEventSchema, calendarEventUpdateSchema } = require("../utils/validators");

const router = express.Router();

router.get("/me/calendar-events", async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT
        id, user_id AS userId, title, description, location,
        start_time AS startTime, end_time AS endTime,
        event_type AS eventType, is_recurring AS isRecurring,
        recurrence_rule AS recurrenceRule,
        recurrence_start_date AS recurrenceStartDate,
        recurrence_end_date AS recurrenceEndDate,
        source,
        created_at AS createdAt, updated_at AS updatedAt
      FROM user_calendar_events
      WHERE user_id = ?
      ORDER BY start_time ASC`,
      [req.auth.userId]
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/me/calendar-events", async (req, res, next) => {
  try {
    const payload = calendarEventSchema.parse(req.body);
    const result = await query(
      `INSERT INTO user_calendar_events
      (user_id, title, description, location, start_time, end_time, event_type, is_recurring, recurrence_rule, recurrence_start_date, recurrence_end_date, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.auth.userId,
        payload.title,
        payload.description || null,
        payload.location || null,
        new Date(payload.startTime),
        new Date(payload.endTime),
        payload.eventType,
        payload.isRecurring ? 1 : 0,
        payload.recurrenceRule || null,
        payload.recurrenceStartDate || null,
        payload.recurrenceEndDate || null,
        payload.source,
      ]
    );
    return res.status(201).json({ id: result.insertId });
  } catch (error) {
    return next(error);
  }
});

router.put("/me/calendar-events/:id", async (req, res, next) => {
  try {
    const eventId = Number(req.params.id);
    const payload = calendarEventUpdateSchema.parse(req.body);
    const currentRows = await query(
      `SELECT title, description, location, start_time AS startTime, end_time AS endTime,
              event_type AS eventType, is_recurring AS isRecurring, recurrence_rule AS recurrenceRule,
              recurrence_start_date AS recurrenceStartDate, recurrence_end_date AS recurrenceEndDate, source
       FROM user_calendar_events
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [eventId, req.auth.userId]
    );

    if (currentRows.length === 0) return res.status(404).json({ message: "Calendar event not found" });

    const current = currentRows[0];
    const merged = {
      title: payload.title ?? current.title,
      description: payload.description !== undefined ? payload.description : current.description,
      location: payload.location !== undefined ? payload.location : current.location,
      startTime: payload.startTime ?? new Date(current.startTime).toISOString(),
      endTime: payload.endTime ?? new Date(current.endTime).toISOString(),
      eventType: payload.eventType ?? current.eventType,
      isRecurring: payload.isRecurring ?? Boolean(current.isRecurring),
      recurrenceRule:
        payload.recurrenceRule !== undefined ? payload.recurrenceRule : current.recurrenceRule,
      recurrenceStartDate:
        payload.recurrenceStartDate !== undefined ? payload.recurrenceStartDate : current.recurrenceStartDate,
      recurrenceEndDate:
        payload.recurrenceEndDate !== undefined ? payload.recurrenceEndDate : current.recurrenceEndDate,
      source: payload.source ?? current.source,
    };

    if (new Date(merged.endTime) <= new Date(merged.startTime)) {
      return res.status(400).json({ message: "endTime must be later than startTime" });
    }

    const result = await query(
      `UPDATE user_calendar_events
      SET title=?, description=?, location=?, start_time=?, end_time=?, event_type=?, is_recurring=?, recurrence_rule=?, recurrence_start_date=?, recurrence_end_date=?, source=?
      WHERE id=? AND user_id=?`,
      [
        merged.title,
        merged.description || null,
        merged.location || null,
        new Date(merged.startTime),
        new Date(merged.endTime),
        merged.eventType,
        merged.isRecurring ? 1 : 0,
        merged.recurrenceRule || null,
        merged.recurrenceStartDate || null,
        merged.recurrenceEndDate || null,
        merged.source,
        eventId,
        req.auth.userId,
      ]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Calendar event not found" });
    return res.json({ message: "Calendar event updated" });
  } catch (error) {
    return next(error);
  }
});

router.delete("/me/calendar-events/:id", async (req, res, next) => {
  try {
    const eventId = Number(req.params.id);
    const result = await query("DELETE FROM user_calendar_events WHERE id = ? AND user_id = ?", [
      eventId,
      req.auth.userId,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Calendar event not found" });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
