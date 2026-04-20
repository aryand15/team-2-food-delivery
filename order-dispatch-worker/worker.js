import express from 'express'
import { createClient } from 'redis'
 
const app = express()
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()
 
const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0
 
app.get('/health', async (req, res) => {
    const checks = {}
    let healthy = true
 
    // Check Redis
    const redisStart = Date.now()
    try {
        await redis.ping()
        checks.redis = {
            status: 'healthy',
            latency_ms: Date.now() - redisStart
        }
    } catch (err) {
        checks.redis = {
            status: 'unhealthy',
            error: err.message
        }
        healthy = false
    }
 
    // Check queue depth
    try {
        const depth = await redis.lLen(process.env.QUEUE_NAME ?? 'orders:queue')
        const dlqDepth = await redis.lLen(process.env.DLQ_NAME ?? 'orders:dlq')
        checks.queue = {
            status: depth < 1000 && dlqDepth === 0 ? 'healthy' : 'degraded',
            depth,
            dlq_depth: dlqDepth
        }
    } catch (err) {
        checks.queue = {
            status: 'unhealthy',
            error: err.message
        }
        healthy = false
    }
 
    // Check worker is processing
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
        status: healthy ? 'healthy' : 'unhealthy',
        service: process.env.SERVICE_NAME ?? 'order-dispatch-worker',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        checks
    })
})
 
app.listen(process.env.PORT ?? 8080)
 
// Worker loop
const QUEUE_NAME = process.env.QUEUE_NAME ?? 'orders:queue'
const DLQ_NAME   = process.env.DLQ_NAME   ?? 'orders:dlq'
 
console.log(JSON.stringify({ event: 'worker_started', queue: QUEUE_NAME }))
 
while (true) {
    try {
        const result = await redis.blPop(QUEUE_NAME, 5)
        if (!result) continue
 
        const start = Date.now()
        let job
 
        try {
            job = JSON.parse(result.element)
        } catch {
            console.log(JSON.stringify({ event: 'parse_error', raw: result.element }))
            await redis.rPush(DLQ_NAME, result.element)
            continue
        }
 
        // Confirm the order was received
        console.log(JSON.stringify({
            event:        'order_received',
            jobId:        job.id ?? 'unknown',
            restaurantId: job.restaurant_id ?? 'unknown',
            timestamp:    new Date().toISOString(),
        }))
 
        lastJobAt = new Date().toISOString()
        jobsProcessed += 1
 
        console.log(JSON.stringify({
            event:          'job_processed',
            jobId:          job.id ?? 'unknown',
            jobs_processed: jobsProcessed,
            processing_ms:  Date.now() - start,
            timestamp:      lastJobAt,
        }))
 
    } catch (err) {
        console.log(JSON.stringify({ event: 'loop_error', error: err.message }))
    }
}
