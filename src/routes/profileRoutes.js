const express = require("express");
const { query } = require("../config/db");
const { updateProfileSchema } = require("../utils/validators");

const router = express.Router();

router.get("/me", async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, username, email, display_name AS displayName, major, avatar_url AS avatarUrl, created_at AS createdAt
       FROM users
       WHERE id = ?`,
      [req.auth.userId]
    );
    if (rows.length === 0) return res.status(404).json({ message: "User not found" });
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.put("/me", async (req, res, next) => {
  try {
    const payload = updateProfileSchema.parse(req.body);
    await query(
      `UPDATE users
       SET display_name = ?, major = ?, avatar_url = ?
       WHERE id = ?`,
      [
        payload.displayName ?? null,
        payload.major ?? null,
        payload.avatarUrl ?? null,
        req.auth.userId,
      ]
    );
    return res.json({ message: "Profile updated" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
