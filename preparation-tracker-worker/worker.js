import express from 'express'
import { createClient } from 'redis'

const app = express()
app.use(express.json())

const config = {
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  // pub/sub channels 
  orderDispatchedChannel: process.env.ORDER_DISPATCHED_CHANNEL || 'order:dispatched',
  orderReadyChannel: process.env.ORDER_READY_CHANNEL || 'order:ready',
  dlqName: process.env.DLQ_NAME || 'prep:dlq',
  serviceName: process.env.SERVICE_NAME || 'preparation-tracker-worker',
  port: Number(process.env.PORT || 8082),
  prepMs: Number(process.env.PREP_MS || 3000),
}

// redis clients
const subscriber  = createClient({ url: config.redisUrl })
const publisher   = createClient({ url: config.redisUrl })
const healthClient = createClient({ url: config.redisUrl })

subscriber.on('error',   (err) => console.error(JSON.stringify({ event: 'redis_error', client: 'subscriber',   error: err.message })))
publisher.on('error',    (err) => console.error(JSON.stringify({ event: 'redis_error', client: 'publisher',    error: err.message })))
healthClient.on('error', (err) => console.error(JSON.stringify({ event: 'redis_error', client: 'healthClient', error: err.message })))

await Promise.all([subscriber.connect(), publisher.connect(), healthClient.connect()])

const startTime = Date.now()
let lastJobAt    = null
let jobsProcessed = 0
let jobsFailed    = 0

function recordJobProcessed() {
  lastJobAt = new Date().toISOString()
  jobsProcessed += 1
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


function validateJob(job) {
  if (!job || typeof job !== 'object') {
    throw new Error('payload must be a JSON object')
  }
  if (!job.orderId) {
    throw new Error('missing required field: orderId')
  }
  if (!job.restaurantId) {
    throw new Error('missing required field: restaurantId')
  }
  if (
    job.prepTimeMs !== undefined &&
    (!Number.isFinite(Number(job.prepTimeMs)) || Number(job.prepTimeMs) < 0)
  ) {
    throw new Error('invalid prepTimeMs: must be a non-negative number')
  }
}


async function sendToDlq(rawMessage, reason) {
  try {
    const entry = JSON.stringify({
      raw: rawMessage,
      dlqReason: reason,
      dlqAt: new Date().toISOString(),
      service: config.serviceName,
    })
    await healthClient.rPush(config.dlqName, entry)
    jobsFailed += 1
    console.error(JSON.stringify({
      event: 'poison_pill_routed',
      dlq: config.dlqName,
      reason,
      rawMessage,
      timestamp: new Date().toISOString(),
    }))
  } catch (dlqErr) {
    console.error(JSON.stringify({
      event: 'dlq_write_failed',
      error: dlqErr.message,
      originalReason: reason,
    }))
  }
}


async function handleMessage(rawMessage) {
  const startedAt = Date.now()
  let job

  try {
    job = JSON.parse(rawMessage)
  } catch (err) {
    await sendToDlq(rawMessage, `invalid JSON: ${err.message}`)
    return
  }

  try {
    validateJob(job)
  } catch (err) {
    await sendToDlq(rawMessage, `validation failed: ${err.message}`)
    return
  }

  const prepTimeMs = Number(job.prepTimeMs ?? config.prepMs)

  console.log(JSON.stringify({
    event: 'prep_started',
    orderId: job.orderId,
    restaurantId: job.restaurantId,
    prepTimeMs,
    timestamp: new Date().toISOString(),
  }))

  await sleep(prepTimeMs)

  // publish "order ready" for delivery tracker worker
  const readyEvent = {
    orderId: job.orderId,
    restaurantId: job.restaurantId,
    driverId: job.driverId ?? null,
    status: 'order_ready',
    preparedAt: new Date().toISOString(),
  }

  try {
    await publisher.publish(config.orderReadyChannel, JSON.stringify(readyEvent))
  } catch (pubErr) {
    console.error(JSON.stringify({
      event: 'publish_error',
      channel: config.orderReadyChannel,
      orderId: job.orderId,
      error: pubErr.message,
    }))
  }

  recordJobProcessed()

  console.log(JSON.stringify({
    event: 'job_processed',
    orderId: job.orderId,
    restaurantId: job.restaurantId,
    processingTimeMs: Date.now() - startedAt,
    published_channel: config.orderReadyChannel,
    jobs_processed: jobsProcessed,
    timestamp: lastJobAt,
  }))
}

// sub to pub/sub channel
await subscriber.subscribe(config.orderDispatchedChannel, async (message) => {
  try {
    await handleMessage(message)
  } catch (err) {
    console.error(JSON.stringify({
      event: 'handler_error',
      error: err.message,
      timestamp: new Date().toISOString(),
    }))
  }
})

console.log(JSON.stringify({
  event: 'worker_started',
  service: config.serviceName,
  subscribed_channel: config.orderDispatchedChannel,
  publishes_to: config.orderReadyChannel,
  dlq: config.dlqName,
  port: config.port,
  timestamp: new Date().toISOString(),
}))

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  const redisStart = Date.now()
  try {
    await healthClient.ping()
    checks.redis = {
      status: 'healthy',
      latency_ms: Date.now() - redisStart,
    }
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  try {
    const dlqDepth = await healthClient.lLen(config.dlqName)
    checks.queue = {
      status: dlqDepth > 0 ? 'degraded' : 'healthy',
      depth: null,         
      dlq_depth: dlqDepth,
      note: 'input is pub/sub — no queue depth; dlq is a Redis list',
    }
  } catch (err) {
    checks.queue = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  const secondsSinceLastJob = lastJobAt
    ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
    : null

  checks.worker = {
    status:
      secondsSinceLastJob === null || secondsSinceLastJob < 120
        ? 'healthy'
        : 'degraded',
    subscribed_channel: config.orderDispatchedChannel,
    last_job_at: lastJobAt ?? 'never',
    jobs_processed: jobsProcessed,
    jobs_failed: jobsFailed,
    seconds_since_last_job: secondsSinceLastJob,
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: config.serviceName,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  })
})

// poison pill endpoint 
app.post('/inject-poison-pill', async (req, res) => {
  const payload = req.body && Object.keys(req.body).length > 0
    ? JSON.stringify(req.body)
    : `{poison-pill: true, "injectedAt": "${new Date().toISOString()}", broken`

  try {
    await publisher.publish(config.orderDispatchedChannel, payload)
    res.status(202).json({
      injected: true,
      channel: config.orderDispatchedChannel,
      dlq: config.dlqName,
      payload,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(config.port)