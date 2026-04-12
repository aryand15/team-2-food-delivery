const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();
const PORT = process.env.PORT || 3003;
const SERVICE_NAME = process.env.SERVICE_NAME || "restaurant";
const startedAt = Date.now();

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const redis = redisUrl ? createClient({ url: redisUrl }) : null;

if (redis) {
  redis.on("error", (error) => {
    console.error("Redis client error:", error.message || String(error));
  });
}

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Restaurant Service is running" });
});

// Temporary restaurants endpoint (replace with DB-backed routes later)
app.get("/restaurants", (req, res) => {
  res.json([
    {
      id: 1,
      name: "Sample Restaurant",
      cuisine: "Test Cuisine",
      is_open: true
    }
  ]);
});

app.get("/health", async (req, res) => {
  const checks = {};
  let healthy = true;

  if (!pool) {
    checks.database = {
      status: "skipped",
      reason: "DATABASE_URL not set"
    };
  } else {
    const dbStart = Date.now();
    try {
      await pool.query("SELECT 1");
      checks.database = {
        status: "healthy",
        latency_ms: Date.now() - dbStart
      };
    } catch (error) {
      checks.database = {
        status: "unhealthy",
        error: error.message
      };
      healthy = false;
    }
  }

  if (!redis) {
    checks.redis = {
      status: "skipped",
      reason: "REDIS_URL not set"
    };
  } else {
    const redisStart = Date.now();
    try {
      const pong = await redis.ping();
      if (pong !== "PONG") {
        throw new Error(`unexpected response: ${pong}`);
      }
      checks.redis = {
        status: "healthy",
        latency_ms: Date.now() - redisStart
      };
    } catch (error) {
      checks.redis = {
        status: "unhealthy",
        error: error.message
      };
      healthy = false;
    }
  }

  const body = {
    status: healthy ? "healthy" : "unhealthy",
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    checks
  };

  res.status(healthy ? 200 : 503).json(body);
});

async function startServer() {
  if (redis) {
    await redis.connect();
  }
  app.listen(PORT, () => {
    console.log(`Restaurant Service listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start Restaurant Service:", error.message || String(error));
  process.exit(1);
});
