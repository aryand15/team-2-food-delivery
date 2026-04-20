import express from 'express'
import pg from 'pg'
import { createClient } from 'redis'

const SERVICE = process.env.SERVICE_NAME ?? 'surge-pricing-worker'
const log = (...args) => console.log(`[surge-worker]`, ...args)

const QUEUE = process.env.QUEUE_NAME || 'orders:volume'
const DLQ = `${QUEUE}:dlq`
const CHANNEL = process.env.SURGE_CHANNEL || 'surge:active'
const THRESHOLD = parseInt(process.env.SURGE_THRESHOLD || '10', 10)
const MULTIPLIER = parseFloat(process.env.SURGE_MULTIPLIER || '1.5')
const DURATION_SECONDS = parseInt(process.env.SURGE_DURATION_SECONDS || '300', 10)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// Separate clients: BLPOP blocks the consumer, so queue-depth and pub/sub need their own.
const redis = createClient({ url: process.env.REDIS_URL })
const consumer = createClient({ url: process.env.REDIS_URL })
const publisher = createClient({ url: process.env.REDIS_URL })
await Promise.all([redis.connect(), consumer.connect(), publisher.connect()])

await pool.query(`
  CREATE TABLE IF NOT EXISTS surges (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER NOT NULL,
    multiplier NUMERIC(4,2) NOT NULL,
    source_event_id TEXT UNIQUE NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  )
`)
await pool.query(`
  CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)

const startTime = Date.now()
let lastProcessedAt = null

const app = express()

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy' }
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  let queue_depth = null
  let dlq_depth = null
  try {
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`)
    queue_depth = await redis.lLen(QUEUE)
    dlq_depth = await redis.lLen(DLQ)
    checks.redis = { status: 'healthy' }
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: SERVICE,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    queue: QUEUE,
    queue_depth,
    dlq_depth,
    last_processed_at: lastProcessedAt,
    checks,
  })
})

async function sendToDlq(raw, reason) {
  log(`DLQ ← "${raw}" (${reason})`)
  await redis.rPush(DLQ, raw)
}

async function handleEvent(raw) {
  let event
  try {
    event = JSON.parse(raw)
  } catch (err) {
    await sendToDlq(raw, `invalid JSON: ${err.message}`)
    return
  }

  const { event_id, restaurant_id, order_count } = event
  if (!event_id || !Number.isInteger(restaurant_id) || typeof order_count !== 'number') {
    await sendToDlq(raw, 'missing event_id / restaurant_id / order_count')
    return
  }

  log(`recv event_id=${event_id} restaurant=${restaurant_id} count=${order_count}`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const claim = await client.query(
      'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
      [event_id]
    )
    if (claim.rowCount === 0) {
      await client.query('COMMIT')
      log(`duplicate event_id=${event_id} — skipping (idempotent)`)
      lastProcessedAt = new Date().toISOString()
      return
    }

    if (order_count >= THRESHOLD) {
      const expiresAt = new Date(Date.now() + DURATION_SECONDS * 1000)
      const ins = await client.query(
        `INSERT INTO surges (restaurant_id, multiplier, source_event_id, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_event_id) DO NOTHING
         RETURNING id, started_at, expires_at`,
        [restaurant_id, MULTIPLIER, event_id, expiresAt]
      )

      if (ins.rowCount > 0) {
        await client.query('COMMIT')
        const surge = ins.rows[0]
        log(`SURGE ACTIVE restaurant=${restaurant_id} x${MULTIPLIER} expires=${surge.expires_at.toISOString()}`)
        await publisher.publish(CHANNEL, JSON.stringify({
          restaurant_id,
          multiplier: MULTIPLIER,
          started_at: surge.started_at,
          expires_at: surge.expires_at,
          source_event_id: event_id,
        }))
      } else {
        await client.query('COMMIT')
        log(`surge already recorded for event_id=${event_id} — no republish`)
      }
    } else {
      await client.query('COMMIT')
      log(`below threshold (${order_count} < ${THRESHOLD}) — no surge`)
    }

    lastProcessedAt = new Date().toISOString()
  } catch (err) {
    await client.query('ROLLBACK')
    log(`processing failed event_id=${event_id}: ${err.message}`)
    await sendToDlq(raw, `processing error: ${err.message}`)
  } finally {
    client.release()
  }
}

async function workerLoop() {
  log(`consuming queue="${QUEUE}" threshold=${THRESHOLD} multiplier=${MULTIPLIER} duration=${DURATION_SECONDS}s`)
  while (true) {
    try {
      const result = await consumer.blPop(QUEUE, 0)
      if (result) await handleEvent(result.element)
    } catch (err) {
      log(`consumer loop error: ${err.message}`)
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

workerLoop().catch(err => {
  console.error('[surge-worker] fatal loop error:', err)
  process.exit(1)
})

const PORT = process.env.PORT || 3005
app.listen(PORT, () => {
  log(`health endpoint listening on port ${PORT}`)
})
