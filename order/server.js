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
    return res.status(400).json({
      error: validation.error
    });
  }
  const { clientOrderId, item, quantity } = payload;

  const insertOrderQuery = `
    INSERT INTO orders (idempotency_key, item, quantity)
    VALUES ($1, $2, $3)
    RETURNING *
  `;

  try {
    const insertResult = await pool.query(insertOrderQuery, [
      clientOrderId,
      item,
      quantity
    ]);
    const createdOrder = insertResult.rows[0];

    await redis.lPush("orders:queue", JSON.stringify(createdOrder));

    return res.status(201).json({
      message: "Order accepted",
      order: createdOrder
    });
  } catch (err) {
    if (err.code === '23505') {
      const existingOrder = await getOrderByIdempotencyKey(clientOrderId);

      if (!existingOrder) {
        return res.status(500).json({
          message: "Order conflict detected but existing order could not be loaded"
        });
      }

      return res.status(200).json({
        message: "Duplicate order",
        order: existingOrder
      });
    }

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
