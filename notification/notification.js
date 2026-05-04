import express from 'express'
import { createClient } from 'redis'

const app = express()

// config not changing here
// maybe add or later
const config = {
    redisUrl: process.env.REDIS_URL,
    queueName: process.env.QUEUE_NAME,
    pipeline: process.env.PIPELINE,
    mode: process.env.MODE,
    minMs: Number(process.env.WORK_SIM_MIN_MS),
    maxMs: Number(process.env.WORK_SIM_MAX_MS),
    ttlSec: Number(process.env.IDEM_TTL_SEC),
    maxRetries: Number(process.env.MAX_RETRIES ),
    dlqName: process.env.DLQ_NAME,
    retryBaseMs: Number(process.env.RETRY_BASE_MS)
}

// set up redis
const client = createClient({ url: config.redisUrl })
await client.connect() 

const workerClient = createClient({ url: config.redisUrl });
await workerClient.connect()

const keys = {
    job: (jobId) => `job:${config.pipeline}:${jobId}`,
    effect: (jobId) => `effect:${config.pipeline}:${jobId}`,
    processed: (jobId) => `processed:${config.pipeline}:${jobId}`,
    totalEffects: () => `effects-total:${config.pipeline}`,
    dlqTotal: () => `dlq-total:${config.pipeline}`
}

// structure redis or dlq writes
const JobStatus = (status, fields = {}) => ({
    status,
    updatedAt: new Date().toISOString(),
    fields
})

const DLQEntry = (job, reason) => ({
    ...job,
    dlqReason: reason,
    dlqAt: new Date().toISOString(),
    pipeline: config.pipeline
})

const RetryJob = (job, attempt) => ({
    ...job,
    retryAttempt: attempt
})

// util functs
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const randomDelayMs = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

function burnCpu(ms) {
  const deadline = Date.now() + ms;
  let x = Math.random();
  while (Date.now() < deadline) {
    x = Math.sqrt(x * x + 1.3) / 1.00001;
  }
  return x; // return so the result can't be eliminated as dead code
}


// worker functs

const applySideEffect = async (jobId) => { // throw on poison pill 
    if (jobId.includes("poison"))
        throw new Error(`poison-pill job rejected: ${jobId}`)

    const delayMs = randomDelayMs(config.minMs, config.maxMs);
    sleep(delayMs);
    const effectCount = await client.incr(keys.effect(jobId));
    await client.expire(keys.effect(jobId), config.ttlSec);
    await client.incr(keys.totalEffects());
    await client.expire(keys.totalEffects(), config.ttlSec);
    return { delayMs, effectCount };
}

const sendToDlq = async (job, reason) => { // move to dlq
    await client.lPush(config.dlqName, JSON.stringify(DLQEntry(job, reason)));
    await client.incr(keys.dlqTotal());
    await client.expire(keys.dlqTotal(), config.ttlSec);

    await client.hSet(
        keys.job(job.jobId),
        JobStatus("dead-lettered", { dlqReason: reason }),
    );

    console.log(
        `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} status=dead-lettered reason="${reason}"`,
    );
};

const scheduleRetry = async (job, attempt, errorMsg) => { // retry bad job
    const backoffMs = config.retryBaseMs * Math.pow(2, attempt - 1);

    await client.hSet(
        keys.job(job.jobId),
        JobStatus("retrying", {
            retryAttempt: String(attempt),
            lastError: errorMsg,
            scheduledAt: new Date(Date.now() + backoffMs).toISOString()
        }),
    );

    console.log(
        `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} status=retrying ` +
            `attempt=${attempt} backoffMs=${backoffMs} error="${errorMsg}"`,
    );

//    await client.lPush(config.queueName, JSON.stringify(RetryJob(job, attempt)));

    setTimeout(async () => {
        try {
            await client.lPush(config.queueName, JSON.stringify(RetryJob(job, attempt)));
            console.log(`pipeline=${config.pipeline} job=${job.jobId} requeued attempt=${attempt}`);
        } catch (err) {
            console.error(`pipeline=${config.pipeline} job=${job.jobId} failed-requeue error=${err.message}`);
        }
    }, backoffMs)
};

const processJob = async (job) => {
    const attempt = job.retryAttempt ?? 0
    await client.hSet(
        keys.job(job.jobId),
        JobStatus("processing", {
            pipeline: config.pipeline,
            mode: config.mode
        }),
    );

    await client.hIncrBy(keys.job(job.jobId), "processAttempts", 1);
    await client.expire(keys.job(job.jobId), config.ttlSec);

    // add idem later...

    try {
        const { delayMs, effectCount } = await applySideEffect(job.jobId)
        const doneAt = new Date().toISOString()

        await client.hSet(
            keys.job(job.jobId),
            JobStatus("done", {
                updatedAt: doneAt,
                finishedAt: doneAt,
                effectCount: String(effectCount),
                // idempotency: config.mode === "idem" ? "applied" : "none",
            }),
        );

        recordJobProcessed()

        console.log( // log message
            `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} ` +
            `status=done effectCount=${effectCount} delayMs=${delayMs}`,
        )

    } catch (err) {
        const nextAttempt = attempt + 1;

        if (nextAttempt > config.maxRetries) {
            await sendToDlq(job, err.message);
        } else {
            await scheduleRetry(job, nextAttempt, err.message);
        }
    }

}

const loop = async () => {
    while (true) {
        const result = await workerClient.brPop(config.queueName, 0)
        const raw = result?.element
        if (!raw) continue

        let job
        try {
            job = JSON.parse(raw)
        } catch (err) {
            console.error("invalid job payload:", err.message)
            await client.lPush(config.dlqName ?? `${config.queueName}:dlq`, raw)
            continue
        }

        try {
            await processJob(job)
        } catch (err) {
            await client.hSet(
                keys.job(job.jobId),
                JobStatus("failed", { error: err.message })
            )
            console.error(
                `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} ` +
               `status=failed error=${err.message}`,
            )
        }

    }
}


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
        await client.ping()
        checks.client = {
            status: 'healthy',
            latency_ms: Date.now() - redisStart
        }
        // healthy still true
    } catch (err) {
        checks.client = {
            status: 'unhealthy',
            error: err.message
        }
        healthy = false // set healthy false
    }   

    // check queue depth
    // flag if backlog is growing

    try {

        const depth = await client.lLen(config.queueName)
        const dlqDepth = await client.lLen(config.dlqName ?? `${config.queueName}:dlq`)

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

app.post('/inject-poison-pill', async (req, res) => {
  try {
    const payload = `{poison-pill: true, "injectedAt": "${new Date().toISOString()}", broken`

    await client.lPush(config.queueName, payload)

    res.status(202).json({
      injected: true,
      queue: config.queueName,
      dlq: config.dlqName,
      payload,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    res.status(500).json({
      error: err.message
    })
  }
})

app.listen(process.env.PORT ?? 8081)

loop().catch((err) => {
  console.error("notification worker loop crashed:", err)
})

