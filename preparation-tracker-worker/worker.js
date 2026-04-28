import express from 'express'
import { createClient } from 'redis'

const app = express()
app.use(express.json())

const config = {
  redisUrl: process.env.REDIS_URL,
  queueName: process.env.QUEUE_NAME || 'prep:queue',
  dlqName: process.env.DLQ_NAME || `${process.env.QUEUE_NAME || 'prep:queue'}:dlq`,
  serviceName: process.env.SERVICE_NAME || 'preparation-tracker-worker',
  port: Number(process.env.PORT || 8082),
  prepMs: Number(process.env.PREP_MS || 3000),
  orderReadyChannel: process.env.ORDER_READY_CHANNEL || 'order:ready',
}

const client = createClient({ url: config.redisUrl })
await client.connect()

const workerClient = createClient({ url: config.redisUrl })
await workerClient.connect()

const publisher = createClient({ url: config.redisUrl })
await publisher.connect()

client.on('error', (err) => {
  console.error(
    JSON.stringify({
      event: 'redis_error',
      client: 'worker',
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

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

function recordJobProcessed() {
  lastJobAt = new Date().toISOString()
  jobsProcessed += 1
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// validate prep job before trying to process it
// if missing/invalid field, treat as poison pill
function validateJob(job) {
  if (!job || typeof job !== 'object') {
    throw new Error('payload must be an object')
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
    throw new Error('invalid prepTimeMs')
  }
}

// push bad message into dlq and log reason it failed
async function sendToDlq(rawMessage, reason) {
  await client.lPush(config.dlqName, rawMessage)

  console.error(
    JSON.stringify({
      event: 'poison_pill_routed',
      queue: config.queueName,
      dlq: config.dlqName,
      error: reason,
      rawMessage,
      timestamp: new Date().toISOString(),
    })
  )
}

async function processJob(rawMessage) {
  const startedAt = Date.now()

  try {
    const job = JSON.parse(rawMessage)
    validateJob(job)

    const prepTimeMs = Number(job.prepTimeMs ?? config.prepMs)

    console.log(
      JSON.stringify({
        event: 'prep_job_received',
        orderId: job.orderId,
        restaurantId: job.restaurantId,
        prepTimeMs,
        timestamp: new Date().toISOString(),
      })
    )

    await sleep(prepTimeMs)

    const readyEvent = {
      orderId: job.orderId,
      restaurantId: job.restaurantId,
      status: 'order_ready',
      preparedAt: new Date().toISOString(),
    }

    await publisher.publish(config.orderReadyChannel, JSON.stringify(readyEvent))

    recordJobProcessed()

    const remainingDepth = await client.lLen(config.queueName)

    console.log(
      JSON.stringify({
        event: 'job_processed',
        orderId: job.orderId,
        restaurantId: job.restaurantId,
        queueDepth: remainingDepth,
        processingTimeMs: Date.now() - startedAt,
        jobsProcessed,
        published_channel: config.orderReadyChannel,
        timestamp: lastJobAt,
      })
    )
  } catch (err) {
    await sendToDlq(rawMessage, err.message)
  }
}

const loop = async () => {
  while (true) {
    try {
      const result = await workerClient.brPop(config.queueName, 0)
      const raw = result?.element
      if (!raw) continue

      await processJob(raw)
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'worker_loop_error',
          error: err.message,
          timestamp: new Date().toISOString(),
        })
      )

      await sleep(1000)
    }
  }
}

// health endpoint 
app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  const redisStart = Date.now()
  try {
    await client.ping()
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

  try {
    const depth = await client.lLen(config.queueName)
    const dlqDepth = await client.lLen(config.dlqName)

    checks.queue = {
      status: dlqDepth > 0 ? 'degraded' : 'healthy',
      depth,
      dlq_depth: dlqDepth,
    }
  } catch (err) {
    checks.queue = {
      status: 'unhealthy',
      error: err.message,
    }
    healthy = false
  }

  const secondsSinceLastJob = lastJobAt
    ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
    : null

  checks.worker = {
    status:
      secondsSinceLastJob === null || secondsSinceLastJob < 60
        ? 'healthy'
        : 'degraded',
    last_job_at: lastJobAt ?? 'never',
    jobs_processed: jobsProcessed,
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

app.post('/inject-poison-pill', async (req, res) => {
  const payload = `{poison-pill: true, "injectedAt": "${new Date().toISOString()}", broken`
  await client.rPush(config.queueName, payload)

  res.json({
    injected: true,
    queue: config.queueName,
    dlq: config.dlqName,
    payload,
    timestamp: new Date().toISOString(),
  })
})

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      event: 'worker_started',
      service: config.serviceName,
      port: config.port,
      queue: config.queueName,
      dlq: config.dlqName,
      publish_channel: config.orderReadyChannel,
      timestamp: new Date().toISOString(),
    })
  )
})

loop().catch((err) => {
  console.error("prep worker loop crashed:", err)
})