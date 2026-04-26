import express from 'express'
import { createClient } from 'redis'

const SERVICE = process.env.SERVICE_NAME ?? 'delivery-tracker-worker'
const log = (...args) => console.log(`[delivery-tracker]`, ...args)

const QUEUE = process.env.QUEUE_NAME || 'deliveries:queue'
const DLQ = `${QUEUE}:dlq`

const redis = createClient({ url: process.env.REDIS_URL })
const consumer = createClient({ url: process.env.REDIS_URL })
await Promise.all([redis.connect(), consumer.connect()])

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

const app = express()

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

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

  // Check queue depths
  let queue_depth = null
  let dlq_depth = null
  try {
    queue_depth = await redis.lLen(QUEUE)
    dlq_depth = await redis.lLen(DLQ)
  } catch (err) {
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
    last_job_at: lastJobAt,
    jobs_processed: jobsProcessed,
    checks,
  })
})

async function handleJob(raw) {
  let job
  try {
    job = JSON.parse(raw)
  } catch (err) {
    log(`parse error — sending to DLQ: ${err.message}`)
    await redis.rPush(DLQ, JSON.stringify({ raw, reason: 'parse_error', error: err.message, dlqAt: new Date().toISOString() }))
    return
  }

  if (!job.id) {
    log(`validation error — missing required field 'id', sending to DLQ`)
    await redis.rPush(DLQ, JSON.stringify({ raw: job, reason: 'validation_error', error: "missing required field 'id'", dlqAt: new Date().toISOString() }))
    return
  }

  const start = Date.now()
  log(JSON.stringify({
    event: 'job_received',
    jobId: job.id ?? 'unknown',
    timestamp: new Date().toISOString(),
  }))

  // TODO: add delivery tracking logic here in the future

  lastJobAt = new Date().toISOString()
  jobsProcessed += 1

  log(JSON.stringify({
    event: 'job_processed',
    jobId: job.id ?? 'unknown',
    jobs_processed: jobsProcessed,
    processing_ms: Date.now() - start,
    timestamp: lastJobAt,
  }))
}

async function workerLoop() {
  log(`consuming queue="${QUEUE}"`)
  while (true) {
    try {
      const result = await consumer.blPop(QUEUE, 0)
      if (result) await handleJob(result.element)
    } catch (err) {
      log(`consumer loop error: ${err.message}`)
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

workerLoop().catch(err => {
  console.error('[delivery-tracker] fatal loop error:', err)
  process.exit(1)
})

const PORT = process.env.PORT || 3006
app.listen(PORT, () => {
  log(`health endpoint listening on port ${PORT}`)
})
