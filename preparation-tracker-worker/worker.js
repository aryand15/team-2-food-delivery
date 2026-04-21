import express from 'express'
import { createClient } from 'redis'

const app = express()

const PORT = Number(process.env.PORT || 8082)
const SERVICE_NAME = process.env.SERVICE_NAME || 'preparation-tracker-worker'
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'

const ORDER_DISPATCHED_CHANNEL =
  process.env.ORDER_DISPATCHED_CHANNEL || 'order:dispatched'
const ORDER_READY_CHANNEL =
  process.env.ORDER_READY_CHANNEL || 'order:ready'

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

const redis = createClient({ url: REDIS_URL })
const subscriber = redis.duplicate()
const publisher = redis.duplicate()

redis.on('error', (err) => {
  console.error(
    JSON.stringify({
      event: 'redis_error',
      client: 'redis',
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  )
})

subscriber.on('error', (err) => {
  console.error(
    JSON.stringify({
      event: 'redis_error',
      client: 'subscriber',
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  )
})

publisher.on('error', (err) => {
  console.error(
    JSON.stringify({
      event: 'redis_error',
      client: 'publisher',
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  )
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'Preparation Tracker Worker is running' })
})

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  const redisStart = Date.now()
  try {
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`)

    checks.redis = {
      status: 'healthy',
      latency_ms: Date.now() - redisStart,
    }
  } catch (err) {
    checks.redis = {
      status: 'unhealthy',
      error: err.message,
    }
    healthy = false
  }

  checks.worker = {
    status: 'healthy',
    depth: 0,
    dlq_depth: 0,
    last_job_at: lastJobAt ?? 'never',
    jobs_processed: jobsProcessed,
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  })
})

async function handleDispatchedEvent(message) {
  const startedAt = Date.now()

  try {
    const payload = JSON.parse(message)

    const orderId = payload.orderId ?? payload.id ?? 'unknown'
    const restaurantId = payload.restaurantId ?? payload.restaurant_id ?? 'unknown'
    const prepTimeMs = Number(payload.prepTimeMs ?? 3000)

    console.log(
      JSON.stringify({
        event: 'order_dispatched_received',
        orderId,
        restaurantId,
        prepTimeMs,
        timestamp: new Date().toISOString(),
      })
    )

    await sleep(prepTimeMs)

    const readyEvent = {
      orderId,
      restaurantId,
      status: 'order_ready',
      preparedAt: new Date().toISOString(),
    }

    await publisher.publish(ORDER_READY_CHANNEL, JSON.stringify(readyEvent))

    lastJobAt = new Date().toISOString()
    jobsProcessed += 1

    console.log(
      JSON.stringify({
        event: 'job_processed',
        orderId,
        restaurantId,
        jobs_processed: jobsProcessed,
        processing_ms: Date.now() - startedAt,
        published_channel: ORDER_READY_CHANNEL,
        timestamp: lastJobAt,
      })
    )
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'prep_worker_error',
        error: err.message,
        rawMessage: message,
        timestamp: new Date().toISOString(),
      })
    )
  }
}

async function start() {
  await redis.connect()
  await subscriber.connect()
  await publisher.connect()

  await subscriber.subscribe(ORDER_DISPATCHED_CHANNEL, handleDispatchedEvent)

  app.listen(PORT, () => {
    console.log(
      JSON.stringify({
        event: 'worker_started',
        service: SERVICE_NAME,
        port: PORT,
        subscribed_channel: ORDER_DISPATCHED_CHANNEL,
        publish_channel: ORDER_READY_CHANNEL,
        timestamp: new Date().toISOString(),
      })
    )
  })
}

start().catch((err) => {
  console.error(
    JSON.stringify({
      event: 'startup_error',
      service: SERVICE_NAME,
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  )
  process.exit(1)
})