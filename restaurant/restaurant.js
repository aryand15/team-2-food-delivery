const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();
const PORT = process.env.PORT || 3003;
const SERVICE_NAME = process.env.SERVICE_NAME || "restaurant";
const MENU_CACHE_TTL_SECONDS = 60;
const startedAt = Date.now();

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

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

async function getRestaurants() {
  if (!pool) {
    throw new Error("DATABASE_URL not set");
  }

  const result = await pool.query(`
    SELECT id, name, cuisine, is_open, created_at, updated_at
    FROM restaurants
    ORDER BY id
  `);

  return result.rows;
}

async function getRestaurantMenu(restaurantId) {
  if (!pool) {
    throw new Error("DATABASE_URL not set");
  }

  const restaurantResult = await pool.query(
    `
      SELECT id
      FROM restaurants
      WHERE id = $1
      LIMIT 1
    `,
    [restaurantId]
  );

  if (restaurantResult.rows.length === 0) {
    return null;
  }

  const menuResult = await pool.query(
    `
      SELECT id, name, description, price, available, created_at, updated_at
      FROM menu_items
      WHERE restaurant_id = $1
      ORDER BY id
    `,
    [restaurantId]
  );

  return {
    restaurant_id: restaurantId,
    items: menuResult.rows
  };
}

app.get("/restaurants", async (req, res) => {
  try {
    const restaurants = await getRestaurants();
    return res.json(restaurants);
  } catch (error) {
    return res.status(503).json({
      error: "Restaurant database unavailable",
      detail: error.message || String(error)
    });
  }
});

app.get("/restaurants/:id/menu", async (req, res) => {
  const restaurantId = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(restaurantId)) {
    return res.status(400).json({ error: "Invalid restaurant id" });
  }

  const cacheKey = `restaurant:${restaurantId}:menu`;

  if (redis) {
    try {
      const cachedMenu = await redis.get(cacheKey);
      if (cachedMenu) {
        return res.json(JSON.parse(cachedMenu));
      }
    } catch (error) {
      console.error("Failed to read menu from Redis:", error.message || String(error));
    }
  }

  let responseBody;
  try {
    responseBody = await getRestaurantMenu(restaurantId);
  } catch (error) {
    return res.status(503).json({
      error: "Restaurant database unavailable",
      detail: error.message || String(error)
    });
  }

  if (!responseBody) {
    return res.status(404).json({ error: "Menu not found for restaurant" });
  }

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(responseBody), {
        EX: MENU_CACHE_TTL_SECONDS
      });
    } catch (error) {
      console.error("Failed to write menu to Redis:", error.message || String(error));
    }
  }

  return res.json(responseBody);
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
