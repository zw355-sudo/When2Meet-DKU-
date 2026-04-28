const { ZodError } = require("zod");
const { AppError } = require("../utils/errors");

function notFoundHandler(req, res) {
  res.status(404).json({ message: "Route not found" });
}

function errorHandler(error, req, res, next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: "Validation failed",
      errors: error.issues,
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  console.error(error);
  return res.status(500).json({ message: "Internal server error" });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
