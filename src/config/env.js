const dotenv = require("dotenv");

dotenv.config();

const env = {
  port: Number(process.env.PORT || 3000),
  dbHost: process.env.DB_HOST || "127.0.0.1",
  dbPort: Number(process.env.DB_PORT || 3306),
  dbUser: process.env.DB_USER || "root",
  dbPassword: process.env.DB_PASSWORD || "123456",
  dbName: process.env.DB_NAME || "dku_scheduler",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3-vl:8b-instruct-q8_0",
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 900000),
  /** Vision models often break with Ollama `format: "json"`; set to "true" only if your model needs it. */
  ollamaVisionFormatJson: String(process.env.OLLAMA_VISION_FORMAT_JSON || "false").toLowerCase() === "true",
  ollamaNumPredictVision: Number(process.env.OLLAMA_NUM_PREDICT_VISION || 4096),
  ollamaNumPredictText: Number(process.env.OLLAMA_NUM_PREDICT_TEXT || 2048),
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || "http://localhost:5173",
};

module.exports = env;
