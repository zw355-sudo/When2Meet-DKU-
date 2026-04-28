const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const env = require("./config/env");

const { requireAuth } = require("./middlewares/auth");
const { errorHandler, notFoundHandler } = require("./middlewares/errorHandler");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const calendarRoutes = require("./routes/calendarRoutes");
const eventRoutes = require("./routes/eventRoutes");
const importRoutes = require("./routes/importRoutes");
const aiRoutes = require("./routes/aiRoutes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  return res.redirect(302, env.frontendBaseUrl);
});

app.get("/profile", (req, res) => {
  return res.redirect(302, `${env.frontendBaseUrl}/profile`);
});

app.get("/event/:slug", (req, res) => {
  return res.redirect(302, `${env.frontendBaseUrl}/event/${req.params.slug}`);
});

app.use("/api/auth", authRoutes);
app.use("/api", requireAuth, profileRoutes);
app.use("/api", requireAuth, calendarRoutes);
app.use("/api", requireAuth, eventRoutes);
app.use("/api", requireAuth, importRoutes);
app.use("/api", requireAuth, aiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
