import express from 'express'
import { createClient } from 'redis'

const app = express()
app.use(express.json())

const config = {
    redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
    queueName: process.env.QUEUE_NAME || 'orders:queue',
    pipeline: process.env.PIPELINE || 'order-dispatch',
    mode: process.env.MODE || 'no-idem',
    ttlSec: Number(process.env.IDEM_TTL_SEC || 86400),
    maxRetries: Number(process.env.MAX_RETRIES || 3),
    retryBaseMs: Number(process.env.RETRY_BASE_MS   || 500),
    driverServiceUrl: process.env.DRIVER_SERVICE_URL || 'http://driver-service:3002',
    restaurantServiceUrl: process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:3003',
    dispatchChannel: process.env.DISPATCH_CHANNEL || 'orders:dispatched',
}

const DLQ_NAME = `${config.queueName}:dlq`

// Redis clients

const redis = createClient({ url: config.redisUrl })
const healthRedis = createClient({ url: config.redisUrl })
const pubRedis = createClient({ url: config.redisUrl })

redis.on('error', (err) => console.error('Redis error:', err.message))
healthRedis.on('error', (err) => console.error('HealthRedis error:', err.message))
pubRedis.on('error', (err) => console.error('PubRedis error:', err.message))

await redis.connect()
await healthRedis.connect()
await pubRedis.connect()

// Redis key helpers

const keys = {
    job: (jobId) => `job:${config.pipeline}:${jobId}`,
    dlqTotal: () => `dlq-total:${config.pipeline}`,
}

const JobStatus = (status, fields = {}) => ({
    status,
    updatedAt: new Date().toISOString(),
    ...fields,
})

const DLQEntry = (job, reason) => ({
    ...job,
    dlqReason: reason,
    dlqAt:     new Date().toISOString(),
    pipeline:  config.pipeline,
})

const RetryJob = (job, attempt) => ({ ...job, retryAttempt: attempt })

const startTime = Date.now()
let lastJobAt     = null
let jobsProcessed = 0
let jobsFailed    = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PoisonPillError extends Error {
    constructor(message) {
        super(message)
        this.name = 'PoisonPillError'
    }
}

function validateJob(job) {
    if (!job.id) return { valid: false, error: 'missing field: id' }
    if (!job.restaurant_id) return { valid: false, error: 'missing field: restaurant_id' }
    if (!Array.isArray(job.items) || job.items.length === 0)
        return { valid: false, error: 'missing or empty field: items' }
    return { valid: true }
}

async function verifyRestaurant(restaurantId) {
    let res
    try {
        res = await fetch(`${config.restaurantServiceUrl}/restaurants/${restaurantId}/menu`, { signal: AbortSignal.timeout(5000) })
    } catch (err) {
        throw new Error(`restaurant service unreachable: ${err.message}`)
    }
    if (res.status === 404 || res.status === 400) {
        throw new PoisonPillError(`restaurant ${restaurantId} not found`)
    }
    if (!res.ok) {
        throw new Error(`restaurant service returned ${res.status}`)
    }
}

async function assignDriver(orderId, restaurantId) {
    const res = await fetch(`${config.driverServiceUrl}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            order_id: orderId, 
            source_event_id: orderId
        }),
        signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
        const text = await res.text()
        throw new Error(`driver service ${res.status}: ${text}`)
    }
    return res.json()
}

// DLQ 

async function sendToDLQ(job, raw, reason) {
    const entry = job ? JSON.stringify(DLQEntry(job, reason)) : raw
    await redis.rPush(DLQ_NAME, entry)
    await redis.incr(keys.dlqTotal())
    await redis.expire(keys.dlqTotal(), config.ttlSec)

    if (job?.id) {
        await redis.hSet(keys.job(job.id), JobStatus('dead-lettered', { dlqReason: reason }))
        await redis.expire(keys.job(job.id), config.ttlSec)
    }

    jobsFailed += 1
    console.log(JSON.stringify({ event: 'dlq_sent', jobId: job?.id ?? 'unknown', reason }))
}

async function scheduleRetry(job, attempt, errorMsg) {
    const backoffMs = config.retryBaseMs * Math.pow(2, attempt - 1) // 500 → 1000 → 2000

    await redis.hSet(
        keys.job(job.id),
        JobStatus('retrying', { retryAttempt: String(attempt), lastError: errorMsg }),
    )
    await redis.expire(keys.job(job.id), config.ttlSec)

    console.log(JSON.stringify({
        event: 'job_retrying', jobId: job.id, attempt, backoffMs, error: errorMsg,
    }))

    await sleep(backoffMs)
    await redis.lPush(config.queueName, JSON.stringify(RetryJob(job, attempt)))
}

async function processJob(job, raw) {
    const attempt = job.retryAttempt ?? 0

    await redis.hSet(keys.job(job.id), JobStatus('processing', { pipeline: config.pipeline }))
    await redis.hIncrBy(keys.job(job.id), 'processAttempts', 1)
    await redis.expire(keys.job(job.id), config.ttlSec)

    const validation = validateJob(job)
    if (!validation.valid) {
        await sendToDLQ(job, raw, `validation_failed: ${validation.error}`)
        return
    }

    try {
        await verifyRestaurant(job.restaurant_id)
    } catch (err) {
        if (err instanceof PoisonPillError) {
            await sendToDLQ(job, raw, err.message)
            return
        }
        throw err  // transient — caught by loop, will retry
    }

    let driverAssignment
    try {
        driverAssignment = await assignDriver(job.id, job.restaurant_id)
    } catch (err) {
        const nextAttempt = attempt + 1
        if (nextAttempt > config.maxRetries) {
            await sendToDLQ(job, raw, `driver_assignment_failed after ${config.maxRetries} retries: ${err.message}`)
        } else {
            await scheduleRetry(job, nextAttempt, err.message)
        }
        return
    }

    try {
        await pubRedis.publish(config.dispatchChannel, JSON.stringify({
            event: 'order_dispatched',
            orderId: job.id,
            restaurantId: job.restaurant_id,
            driverId: driverAssignment?.driver_id ?? null,
            dispatchedAt: new Date().toISOString(),
        }))
    } catch (err) {
        console.log(JSON.stringify({ event: 'pubsub_error', jobId: job.id, error: err.message }))
    }

    const doneAt = new Date().toISOString()
    await redis.hSet(keys.job(job.id), JobStatus('done', {
        finishedAt: doneAt,
        driverId: String(driverAssignment?.driver_id ?? 'unknown'),
    }))
    await redis.expire(keys.job(job.id), config.ttlSec)

    lastJobAt = doneAt
    jobsProcessed += 1

    console.log(JSON.stringify({
        event: 'job_processed',
        jobId: job.id,
        restaurantId: job.restaurant_id,
        driverId: driverAssignment?.driver_id ?? null,
        jobs_processed: jobsProcessed,
        timestamp: lastJobAt,
    }))
}

// Health endpoint

app.get('/health', async (req, res) => {
    const checks = {}
    let healthy = true

    const redisStart = Date.now()
    try {
        await healthRedis.ping()
        checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart }
    } catch (err) {
        checks.redis = { status: 'unhealthy', error: err.message }
        healthy = false
    }

    try {
        const depth = await healthRedis.lLen(config.queueName)
        const dlqDepth = await healthRedis.lLen(DLQ_NAME)
        checks.queue = {
            status: dlqDepth > 0 ? 'degraded' : 'healthy',
            depth,
            dlq_depth: dlqDepth,
        }
    } catch (err) {
        checks.queue = { status: 'unhealthy', error: err.message }
        healthy = false
    }

    const secondsSinceLastJob = lastJobAt
        ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
        : null
    checks.worker = {
        status: secondsSinceLastJob === null || secondsSinceLastJob < 60 ? 'healthy' : 'degraded',
        last_job_at: lastJobAt ?? 'never',
        jobs_processed: jobsProcessed,
        jobs_failed: jobsFailed,
        seconds_since_last_job: secondsSinceLastJob,
    }

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'unhealthy',
        service: process.env.SERVICE_NAME ?? 'order-dispatch-worker',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        checks,
    })
})

// Poison-pill injection endpoint
// POST /poison-pill with no body  → injects a schema-invalid message
// POST /poison-pill + JSON body   → injects that payload (e.g. {"id":"x","restaurant_id":"bad-999","items":[...]})

app.post('/poison-pill', async (req, res) => {
    const raw = req.body && Object.keys(req.body).length > 0
        ? JSON.stringify(req.body)
        : JSON.stringify({ __poison: true, injectedAt: new Date().toISOString() })

    try {
        await redis.lPush(config.queueName, raw)
        res.status(202).json({
            message: 'Poison pill injected into queue',
            queue: config.queueName,
            dlq: DLQ_NAME,
            injected: raw,
        })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

app.listen(process.env.PORT ?? 8080)

console.log(JSON.stringify({
    event: 'worker_started',
    queue: config.queueName,
    dlq: DLQ_NAME,
    maxRetries: config.maxRetries,
    pipeline: config.pipeline,
}))

while (true) {
    try {
        const result = await redis.blPop(config.queueName, 5)
        if (!result) continue

        const raw = result.element
        let job

        // Parse — invalid JSON goes straight to DLQ
        try {
            job = JSON.parse(raw)
        } catch {
            console.log(JSON.stringify({ event: 'parse_error', raw }))
            await redis.rPush(DLQ_NAME, raw)
            await redis.incr(keys.dlqTotal())
            jobsFailed += 1
            continue
        }

        console.log(JSON.stringify({
            event: 'order_received',
            jobId: job.id ?? 'unknown',
            restaurantId: job.restaurant_id ?? 'unknown',
            retryAttempt: job.retryAttempt ?? 0,
            timestamp: new Date().toISOString(),
        }))

        try {
            await processJob(job, raw)
        } catch (err) {
            console.log(JSON.stringify({ event: 'loop_error', jobId: job.id ?? 'unknown', error: err.message }))
            if (job.id) {
                await redis.hSet(keys.job(job.id), JobStatus('failed', { error: err.message }))
            }
        }

    } catch (err) {
        console.log(JSON.stringify({ event: 'loop_error', error: err.message }))
    }
}
