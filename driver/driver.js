import express from 'express'
import pg from 'pg'
import { createClient } from 'redis'

const app = express()
app.use(express.json())

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

await pool.query(`
  CREATE TABLE IF NOT EXISTS drivers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    status TEXT NOT NULL CHECK (status IN ('available','busy','offline')) DEFAULT 'available',
    current_lat NUMERIC(9,6),
    current_lng NUMERIC(9,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)
await pool.query(`
  CREATE TABLE IF NOT EXISTS driver_assignments (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    order_id TEXT NOT NULL,
    source_event_id TEXT UNIQUE NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_driver_assignments_driver ON driver_assignments(driver_id)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_driver_assignments_order ON driver_assignments(order_id)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status)`)

const seedCount = await pool.query(`SELECT COUNT(*)::int AS c FROM drivers`)
if (seedCount.rows[0].c === 0) {
  await pool.query(`
    INSERT INTO drivers (name, phone, status, current_lat, current_lng) VALUES
      ('Avery Chen',    '+1-555-0101', 'available', 42.349500, -71.078900),
      ('Bilal Hassan',  '+1-555-0102', 'available', 42.351200, -71.082300),
      ('Carla Diaz',    '+1-555-0103', 'available', 42.347800, -71.085100),
      ('Devon Reyes',   '+1-555-0104', 'available', 42.354100, -71.080000),
      ('Erin O''Neil',  '+1-555-0105', 'offline',   42.350000, -71.090000)
  `)
  console.log('[driver-service] seeded 5 drivers')
}

const startTime = Date.now()

app.get('/health', async (_req, res) => {
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
    service: process.env.SERVICE_NAME ?? 'driver-service',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  })
})

const VALID_STATUSES = new Set(['available', 'busy', 'offline'])

function isValidLatLng(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

app.get('/drivers', async (req, res) => {
  const { status } = req.query
  if (status && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `status must be one of ${[...VALID_STATUSES].join(', ')}` })
  }
  const { rows } = status
    ? await pool.query(
        `SELECT id, name, phone, status, current_lat, current_lng, updated_at
           FROM drivers WHERE status = $1 ORDER BY id`,
        [status]
      )
    : await pool.query(
        `SELECT id, name, phone, status, current_lat, current_lng, updated_at
           FROM drivers ORDER BY id`
      )
  res.json(rows)
})

app.get('/drivers/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' })
  }
  const { rows } = await pool.query(
    `SELECT id, name, phone, status, current_lat, current_lng, created_at, updated_at
       FROM drivers WHERE id = $1`,
    [id]
  )
  if (rows.length === 0) return res.status(404).json({ error: 'driver not found' })
  res.json(rows[0])
})

app.post('/drivers', async (req, res) => {
  const { name, phone, current_lat, current_lng } = req.body ?? {}
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' })
  }
  if (current_lat != null && current_lng != null && !isValidLatLng(current_lat, current_lng)) {
    return res.status(400).json({ error: 'current_lat/current_lng out of range' })
  }
  const { rows } = await pool.query(
    `INSERT INTO drivers (name, phone, current_lat, current_lng)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, status, current_lat, current_lng, created_at, updated_at`,
    [name, phone ?? null, current_lat ?? null, current_lng ?? null]
  )
  res.status(201).json(rows[0])
})

app.patch('/drivers/:id/status', async (req, res) => {
  const id = Number(req.params.id)
  const { status } = req.body ?? {}
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' })
  }
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `status must be one of ${[...VALID_STATUSES].join(', ')}` })
  }
  const { rows } = await pool.query(
    `UPDATE drivers SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, status, updated_at`,
    [status, id]
  )
  if (rows.length === 0) return res.status(404).json({ error: 'driver not found' })
  res.json(rows[0])
})

app.patch('/drivers/:id/location', async (req, res) => {
  const id = Number(req.params.id)
  const { lat, lng } = req.body ?? {}
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' })
  }
  if (!isValidLatLng(lat, lng)) {
    return res.status(400).json({ error: 'lat/lng required and within [-90,90]/[-180,180]' })
  }
  const { rows } = await pool.query(
    `UPDATE drivers SET current_lat = $1, current_lng = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, current_lat, current_lng, updated_at`,
    [lat, lng, id]
  )
  if (rows.length === 0) return res.status(404).json({ error: 'driver not found' })
  res.json(rows[0])
})

app.post('/assignments', async (req, res) => {
  const { order_id, source_event_id } = req.body ?? {}
  if (!order_id || typeof order_id !== 'string') {
    return res.status(400).json({ error: 'order_id required' })
  }
  if (!source_event_id || typeof source_event_id !== 'string') {
    return res.status(400).json({ error: 'source_event_id required (idempotency key)' })
  }

  const existing = await pool.query(
    `SELECT id, driver_id, order_id, source_event_id, assigned_at
       FROM driver_assignments WHERE source_event_id = $1`,
    [source_event_id]
  )
  if (existing.rows.length > 0) {
    return res.status(200).json({ message: 'already assigned', assignment: existing.rows[0] })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pick = await client.query(
      `SELECT id FROM drivers
         WHERE status = 'available'
         ORDER BY updated_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
    )
    if (pick.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'no drivers available' })
    }
    const driverId = pick.rows[0].id

    const inserted = await client.query(
      `INSERT INTO driver_assignments (driver_id, order_id, source_event_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (source_event_id) DO NOTHING
         RETURNING id, driver_id, order_id, source_event_id, assigned_at`,
      [driverId, order_id, source_event_id]
    )
    if (inserted.rows.length === 0) {
      // Lost a race: another request inserted with same source_event_id between our check and now.
      await client.query('ROLLBACK')
      const winner = await pool.query(
        `SELECT id, driver_id, order_id, source_event_id, assigned_at
           FROM driver_assignments WHERE source_event_id = $1`,
        [source_event_id]
      )
      return res.status(200).json({ message: 'already assigned', assignment: winner.rows[0] })
    }

    await client.query(
      `UPDATE drivers SET status = 'busy', updated_at = NOW() WHERE id = $1`,
      [driverId]
    )
    await client.query('COMMIT')
    res.status(201).json(inserted.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: 'assignment failed', detail: err.message })
  } finally {
    client.release()
  }
})

const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  console.log(`Driver service listening on port ${PORT}`)
})
