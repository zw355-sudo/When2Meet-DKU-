const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");
const env = require("../config/env");
const { AppError } = require("../utils/errors");
const { loginSchema, registerSchema } = require("../utils/validators");

const router = express.Router();

router.post("/register", async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(payload.password, 10);

    const result = await query(
      `INSERT INTO users (username, email, password_hash, display_name, major, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.username,
        payload.email,
        passwordHash,
        payload.displayName || null,
        payload.major || null,
        payload.avatarUrl || null,
      ]
    );

    const token = jwt.sign({ userId: result.insertId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
    return res.status(201).json({ token, userId: result.insertId });
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      return next(new AppError(409, "Username or email already exists"));
    }
    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const rows = await query("SELECT id, password_hash FROM users WHERE email = ? LIMIT 1", [payload.email]);

    if (rows.length === 0) throw new AppError(401, "Invalid email or password");
    const user = rows[0];

    const ok = await bcrypt.compare(payload.password, user.password_hash);
    if (!ok) throw new AppError(401, "Invalid email or password");

    const token = jwt.sign({ userId: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
    return res.json({ token, userId: user.id });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
