const app = require("./app");
const env = require("./config/env");
const { query } = require("./config/db");

async function bootstrap() {
  try {
    await query("SELECT 1");
    app.listen(env.port, () => {
      console.log(`Server running at http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

bootstrap();
