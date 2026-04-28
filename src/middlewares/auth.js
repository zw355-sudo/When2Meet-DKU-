const jwt = require("jsonwebtoken");
const env = require("../config/env");

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Missing or invalid authorization token" });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.auth = { userId: payload.userId };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Token expired or invalid" });
  }
}

module.exports = {
  requireAuth,
};
