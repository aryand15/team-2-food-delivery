import express from 'express'
import { createClient } from 'redis'

// server and redis setup 
const app = express()
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

export function recordJobProcessed() {
    lastJobAt = new Date().toISOString()
    jobsProcessed += 1
}

app.get('/health', async (req, res) => {
    const checks = {}
    let healthy = true

    // check redis
    const redisStart = Date.now();
    try {
        await redis.ping()
        checks.redis = {
            status: 'healthy',
            latency_ms: Date.now() - redisStart
        }
        // healthy still true
    } catch (err) {
        checks.redis = {
            status: 'unhealthy',
            error: err.message
        }
        healthy = false // set healthy false
    }   

    // check queue depth
    // flag if backlog is growing

    try {

        const depth = await redis.lLen(process.env.QUEUE_NAME)
        const dlqDepth = await redis.lLen(process.env.DLQ_NAME ?? `${process.env.QUEUE_NAME}:dlq`)

        checks.queue = {
            status: depth < 1000 ? 'healthy' : 'degraded',
            depth,
            dlq_depth: dlqDepth
        }

        if (dlqDepth > 0) {
            checks.queue.status = 'degraded'
        }
        // healthy still true
    } catch (err) {
        checks.queue = {
            status: 'unhealthy',
            error: err.message
        }
        healthy = false; 
    }

    // check that the worker is actually processing
    const secondsSinceLastJob = lastJobAt
    ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
    : null

    checks.worker = {
        status: secondsSinceLastJob === null || secondsSinceLastJob < 60
        ? 'healthy'
        : 'degraded',

        last_job_at: lastJobAt ?? 'never',
        jobs_processed: jobsProcessed,
        seconds_since_last_job: secondsSinceLastJob
    }

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy': 'unhealthy',
        service: process.env.SERVICE_NAME ?? 'worker',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        checks
    })

})

app.listen(process.env.PORT ?? 8081)

// need to add posion pill handling