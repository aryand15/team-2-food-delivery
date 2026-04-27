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
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ratings_order_id_unique ON ratings(order_id)`)
await pool.query(`CREATE INDEX IF NOT EXISTS ratings_restaurant_id_idx ON ratings(restaurant_id)`)

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
  if (!Number.isInteger(restaurant_id)) {
    return res.status(400).json({ error: 'restaurant_id must be an integer' })
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be an integer between 1 and 5' })
  }
  if (review != null && (typeof review !== 'string' || review.length > 2000)) {
    return res.status(400).json({ error: 'review must be a string ≤2000 chars' })
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
     ON CONFLICT (order_id) DO NOTHING
     RETURNING id, order_id, restaurant_id, customer_id, rating, review, created_at`,
    [order_id, restaurant_id, customer_id, rating, review ?? null]
  )

  if (rows.length === 0) {
    const existing = await pool.query(
      `SELECT id, order_id, restaurant_id, customer_id, rating, review, created_at
         FROM ratings WHERE order_id = $1`,
      [order_id]
    )
    return res.status(200).json({ message: 'rating already submitted', rating: existing.rows[0] })
  }

  const saved = rows[0]

  await redis.publish('rating:submitted', JSON.stringify({
    rating_id: saved.id,
    order_id: saved.order_id,
    restaurant_id: saved.restaurant_id,
    rating: saved.rating,
  }))

  res.status(201).json(saved)
})

app.get('/ratings/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' })
  }
  const { rows } = await pool.query(
    `SELECT id, order_id, restaurant_id, customer_id, rating, review, created_at
       FROM ratings WHERE id = $1`,
    [id]
  )
  if (rows.length === 0) return res.status(404).json({ error: 'rating not found' })
  res.json(rows[0])
})

app.get('/restaurants/:restaurant_id/ratings', async (req, res) => {
  const restaurantId = Number(req.params.restaurant_id)
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
    return res.status(400).json({ error: 'restaurant_id must be a positive integer' })
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const { rows } = await pool.query(
    `SELECT id, order_id, customer_id, rating, review, created_at
       FROM ratings WHERE restaurant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
    [restaurantId, limit, offset]
  )
  const total = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ratings WHERE restaurant_id = $1`,
    [restaurantId]
  )
  res.json({ restaurant_id: restaurantId, total: total.rows[0].c, limit, offset, ratings: rows })
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
