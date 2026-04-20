import express from 'express'
import pg from 'pg'
import { createClient } from 'redis'
import { validateOrderPayload } from "./order-utils.js";

const app = express()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

const startTime = Date.now()

app.use(express.json());

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  // Check PostgreSQL
  const dbStart = Date.now()
  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart }
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  // Check Redis
  const redisStart = Date.now()
  try {
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`)
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart }
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  const body = {
    status: healthy ? 'healthy' : 'unhealthy',
    service: process.env.SERVICE_NAME ?? 'unknown',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  }

  res.status(healthy ? 200 : 503).json(body)
})

// Placeholder endpoint for getting drivers from driver service
app.get('/get-drivers', async (req, res) => {
    const response = await fetch("http://driver-service:3002/drivers");
    const data = await response.json();
    res.json(data);
})

const getOrderByIdempotencyKey = async (idempotencyKey) => {
  const result = await pool.query(
    'SELECT * FROM orders WHERE idempotency_key = $1 LIMIT 1',
    [idempotencyKey]
  );
  return result.rows[0] ?? null;
};

app.post("/orders", async (req, res) => {
  const payload = req.body ?? {};
  const validation = validateOrderPayload(payload);

  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const { clientOrderId, restaurantId, items } = payload;

  // TODO: verify restaurantId and each item's menuItemId via the restaurant service
  // once that service's schema is available.


  const query = `
    INSERT INTO orders (idempotency_key, restaurant_id, items)
    VALUES ($1, $2, $3)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
  `;

  try {
    const insertResult = await pool.query(query, [
      clientOrderId,
      restaurantId,
      JSON.stringify(items)
    ]);
    let order;
    if (insertResult.rows.length > 0) {
      order = insertResult.rows[0];
      try {
        await redis.lPush("orders:queue", JSON.stringify(order));
      } catch (e) {
        console.error("Redis enqueue failed:", e);
      }
      return res.status(201).json({
        message: "Order accepted",
        order
      });
    } else {
      order = await getOrderByIdempotencyKey(clientOrderId);

      return res.status(200).json({
        message: "Duplicate order",
        order
      });
    }
  } catch (err) {
    return res.status(500).json({
      message: "Internal server error",
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
    console.log(`Order service listening on port ${PORT}`)
})
