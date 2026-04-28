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

async function getRestaurantById(restaurantId) {
  if (!pool) {
    throw new Error("DATABASE_URL not set");
  }

  const result = await pool.query(
    `
      SELECT id, name, cuisine, is_open, created_at, updated_at
      FROM restaurants
      WHERE id = $1
      LIMIT 1
    `,
    [restaurantId]
  );

  return result.rows[0] ?? null;
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

async function invalidateMenuCache(restaurantId) {
  if (!redis) {
    return;
  }

  const cacheKey = `restaurant:${restaurantId}:menu`;
  try {
    await redis.del(cacheKey);
  } catch (error) {
    console.error("Failed to invalidate menu cache:", error.message || String(error));
  }
}

function getIdempotencyKey(req) {
  const headerValue = req.get("Idempotency-Key");
  return typeof headerValue === "string" && headerValue.trim() ? headerValue.trim() : null;
}

async function getStoredIdempotentResponse(operation, idempotencyKey) {
  if (!pool) {
    throw new Error("DATABASE_URL not set");
  }

  const result = await pool.query(
    `
      SELECT status, response_status, response_body
      FROM idempotency_keys
      WHERE operation = $1 AND idempotency_key = $2
      LIMIT 1
    `,
    [operation, idempotencyKey]
  );

  return result.rows[0] ?? null;
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

app.get("/restaurants/:id", async (req, res) => {
  const restaurantId = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(restaurantId)) {
    return res.status(400).json({ error: "Invalid restaurant id" });
  }

  try {
    const restaurant = await getRestaurantById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    return res.json(restaurant);
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

app.post("/restaurants/:id/menu", async (req, res) => {
  const restaurantId = Number.parseInt(req.params.id, 10);
  const { name, description, price, available } = req.body ?? {};
  const idempotencyKey = getIdempotencyKey(req);
  const operation = "create_menu_item";

  if (Number.isNaN(restaurantId)) {
    return res.status(400).json({ error: "Invalid restaurant id" });
  }

  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }

  if (typeof price !== "number" || Number.isNaN(price) || price < 0) {
    return res.status(400).json({ error: "price must be a non-negative number" });
  }

  try {
    if (idempotencyKey) {
      const existing = await getStoredIdempotentResponse(operation, idempotencyKey);
      if (existing) {
        if (existing.status === "completed") {
          return res.status(existing.response_status).json(existing.response_body);
        }

        return res.status(409).json({
          error: "Request with this Idempotency-Key is already in progress"
        });
      }
    }

    const restaurant = await getRestaurantById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    const client = await pool.connect();
    let createdItem;
    try {
      await client.query("BEGIN");

      if (idempotencyKey) {
        const claim = await client.query(
          `
            INSERT INTO idempotency_keys (operation, idempotency_key, status)
            VALUES ($1, $2, 'processing')
            ON CONFLICT DO NOTHING
            RETURNING operation
          `,
          [operation, idempotencyKey]
        );

        if (claim.rowCount === 0) {
          await client.query("ROLLBACK");
          const existing = await getStoredIdempotentResponse(operation, idempotencyKey);
          if (existing?.status === "completed") {
            return res.status(existing.response_status).json(existing.response_body);
          }

          return res.status(409).json({
            error: "Request with this Idempotency-Key is already in progress"
          });
        }
      }

      const result = await client.query(
        `
          WITH next_id AS (
            SELECT COALESCE(MAX(id), 0) + 1 AS id
            FROM menu_items
          )
          INSERT INTO menu_items (id, restaurant_id, name, description, price, available)
          SELECT id, $1, $2, $3, $4, $5
          FROM next_id
          RETURNING id, restaurant_id, name, description, price, available, created_at, updated_at
        `,
        [
          restaurantId,
          name.trim(),
          description ?? null,
          price,
          typeof available === "boolean" ? available : true
        ]
      );

      createdItem = result.rows[0];

      if (idempotencyKey) {
        await client.query(
          `
            UPDATE idempotency_keys
            SET status = 'completed',
                response_status = $3,
                response_body = $4::jsonb
            WHERE operation = $1 AND idempotency_key = $2
          `,
          [operation, idempotencyKey, 201, JSON.stringify(createdItem)]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await invalidateMenuCache(restaurantId);
    return res.status(201).json(createdItem);
  } catch (error) {
    return res.status(503).json({
      error: "Restaurant database unavailable",
      detail: error.message || String(error)
    });
  }
});

app.patch("/restaurants/:id/menu/:itemId", async (req, res) => {
  const restaurantId = Number.parseInt(req.params.id, 10);
  const itemId = Number.parseInt(req.params.itemId, 10);
  const { name, description, price, available } = req.body ?? {};

  if (Number.isNaN(restaurantId) || Number.isNaN(itemId)) {
    return res.status(400).json({ error: "Invalid restaurant id or menu item id" });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) {
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    values.push(name.trim());
    updates.push(`name = $${values.length}`);
  }

  if (description !== undefined) {
    if (description !== null && typeof description !== "string") {
      return res.status(400).json({ error: "description must be a string or null" });
    }
    values.push(description);
    updates.push(`description = $${values.length}`);
  }

  if (price !== undefined) {
    if (typeof price !== "number" || Number.isNaN(price) || price < 0) {
      return res.status(400).json({ error: "price must be a non-negative number" });
    }
    values.push(price);
    updates.push(`price = $${values.length}`);
  }

  if (available !== undefined) {
    if (typeof available !== "boolean") {
      return res.status(400).json({ error: "available must be a boolean" });
    }
    values.push(available);
    updates.push(`available = $${values.length}`);
  }

  if (updates.length === 0) {
    return res.status(400).json({
      error: "At least one of name, description, price, or available must be provided"
    });
  }

  values.push(restaurantId, itemId);

  try {
    const restaurant = await getRestaurantById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    const result = await pool.query(
      `
        UPDATE menu_items
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE restaurant_id = $${values.length - 1} AND id = $${values.length}
        RETURNING id, restaurant_id, name, description, price, available, created_at, updated_at
      `,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Menu item not found" });
    }

    await invalidateMenuCache(restaurantId);
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(503).json({
      error: "Restaurant database unavailable",
      detail: error.message || String(error)
    });
  }
});

app.delete("/restaurants/:id/menu/:itemId", async (req, res) => {
  const restaurantId = Number.parseInt(req.params.id, 10);
  const itemId = Number.parseInt(req.params.itemId, 10);

  if (Number.isNaN(restaurantId) || Number.isNaN(itemId)) {
    return res.status(400).json({ error: "Invalid restaurant id or menu item id" });
  }

  try {
    const restaurant = await getRestaurantById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    const result = await pool.query(
      `
        DELETE FROM menu_items
        WHERE restaurant_id = $1 AND id = $2
        RETURNING id, restaurant_id, name, description, price, available, created_at, updated_at
      `,
      [restaurantId, itemId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Menu item not found" });
    }

    await invalidateMenuCache(restaurantId);
    return res.json({
      message: "Menu item deleted",
      item: result.rows[0]
    });
  } catch (error) {
    return res.status(503).json({
      error: "Restaurant database unavailable",
      detail: error.message || String(error)
    });
  }
});

app.delete("/restaurants/:id", async (req, res) => {
  const restaurantId = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(restaurantId)) {
    return res.status(400).json({ error: "Invalid restaurant id" });
  }

  try {
    const result = await pool.query(
      `
        DELETE FROM restaurants
        WHERE id = $1
        RETURNING id, name, cuisine, is_open, created_at, updated_at
      `,
      [restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    await invalidateMenuCache(restaurantId);
    return res.json({
      message: "Restaurant deleted",
      restaurant: result.rows[0]
    });
  } catch (error) {
    return res.status(503).json({
      error: "Restaurant database unavailable",
      detail: error.message || String(error)
    });
  }
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
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        operation TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        response_status INTEGER,
        response_body JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (operation, idempotency_key)
      )
    `);
  }
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
