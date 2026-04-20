import express from 'express'
import pg from 'pg'
import { createClient } from 'redis'

const app = express()
app.use(express.json())

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

await pool.query(`
  CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY,
    order_id TEXT NOT NULL,
    restaurant_id INTEGER NOT NULL,
    customer_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`)

const startTime = Date.now()
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3001'

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  const dbStart = Date.now()
  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart }
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  const redisStart = Date.now()
  try {
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`)
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart }
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: process.env.SERVICE_NAME ?? 'rating-service',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  })
})

// Accepts post-delivery ratings. Validates order via sync call to order-service,
// stores the rating, and publishes a "rating:submitted" event on Redis pub/sub.
app.post('/ratings', async (req, res) => {
  const { order_id, restaurant_id, customer_id, rating, review } = req.body ?? {}

  if (!order_id || !restaurant_id || !customer_id || !rating) {
    return res.status(400).json({ error: 'order_id, restaurant_id, customer_id, and rating are required' })
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be an integer between 1 and 5' })
  }

  try {
    const orderResp = await fetch(`${ORDER_SERVICE_URL}/orders/${order_id}`)
    if (!orderResp.ok) {
      return res.status(400).json({ error: 'order not found or not completed' })
    }
  } catch (err) {
    return res.status(503).json({ error: 'order-service unreachable', detail: err.message })
  }

  const { rows } = await pool.query(
    `INSERT INTO ratings (order_id, restaurant_id, customer_id, rating, review)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, order_id, restaurant_id, customer_id, rating, review, created_at`,
    [order_id, restaurant_id, customer_id, rating, review ?? null]
  )
  const saved = rows[0]

  await redis.publish('rating:submitted', JSON.stringify({
    rating_id: saved.id,
    order_id: saved.order_id,
    restaurant_id: saved.restaurant_id,
    rating: saved.rating,
  }))

  res.status(201).json(saved)
})

// Aggregate average rating per restaurant.
app.get('/rankings', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT restaurant_id,
           ROUND(AVG(rating)::numeric, 2) AS average_rating,
           COUNT(*) AS total_ratings
    FROM ratings
    GROUP BY restaurant_id
    ORDER BY average_rating DESC, total_ratings DESC
  `)
  res.json(rows)
})

const PORT = process.env.PORT || 3004
app.listen(PORT, () => {
  console.log(`Rating service listening on port ${PORT}`)
})
