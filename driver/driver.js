import express from 'express'
import pg from 'pg'
import { createClient } from 'redis'

const app = express()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

const startTime = Date.now()

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

    const body = {
        status: healthy ? 'healthy' : 'unhealthy',
        service: process.env.SERVICE_NAME ?? 'driver-service',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        checks,
    }
    
    res.status(healthy ? 200 : 503).json(body)
})

// Placeholder endpoint for drivers
app.get('/drivers', async (req, res) => {
    // Placeholder data
    const drivers = [
        { id: 1, name: 'John Doe', status: 'available' },
        { id: 2, name: 'Jane Smith', status: 'busy' }
    ]
    res.json(drivers)
})

const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
    console.log(`Driver service listening on port ${PORT}`)
})