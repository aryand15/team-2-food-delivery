import express from 'express'
import pg from 'pg'
import { createClient } from 'redis'

const app = express()
const port = process.env.PORT || 3002
const service = process.env.SERVICE_NAME || "driver"  

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: process.env.REDIS_URL })
// await redis.connect()

if (redis)

// check redis
redis.on('error', err => {
    console.error("Redis error:", err.message)
})


app.use(express.json())

app.get("/", (req, res) => {
    res.json({message: "Driver service running."})
})

// health endpoint
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
        service: process.env.service ?? 'unknown',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        checks,
    }
    
    res.status(healthy ? 200 : 503).json(body)

})

// start server
async function start() {
  if (redis) {
    await redis.connect();
  }
  app.listen(PORT, () => {
    console.log(`Driver service listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start driver service:", error.message || String(error));
  process.exit(1);
});