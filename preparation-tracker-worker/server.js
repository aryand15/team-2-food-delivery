const express = require("express");
const { createClient } = require("redis");

const app = express();
const PORT = process.env.PORT || 8082;

const REDIS_HOST = process.env.REDIS_HOST || "redis";
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const ORDER_DISPATCHED_CHANNEL =
  process.env.ORDER_DISPATCHED_CHANNEL || "order:dispatched";
const ORDER_READY_CHANNEL =
  process.env.ORDER_READY_CHANNEL || "order:ready";

app.use(express.json());

let jobsProcessed = 0;
let lastJobAt = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startWorker() {
  const subscriber = createClient({
    socket: {
      host: REDIS_HOST,
      port: Number(REDIS_PORT),
    },
  });

  const publisher = createClient({
    socket: {
      host: REDIS_HOST,
      port: Number(REDIS_PORT),
    },
  });

  subscriber.on("error", (err) => {
    console.error("Redis subscriber error:", err.message);
  });

  publisher.on("error", (err) => {
    console.error("Redis publisher error:", err.message);
  });

  await subscriber.connect();
  await publisher.connect();

  console.log(
    `Preparation Tracker Worker subscribed to "${ORDER_DISPATCHED_CHANNEL}"`
  );

  await subscriber.subscribe(ORDER_DISPATCHED_CHANNEL, async (message) => {
    try {
      const payload = JSON.parse(message);

      const orderId = payload.orderId;
      const restaurantId = payload.restaurantId;
      const prepTimeMs = payload.prepTimeMs || 3000;

      console.log(
        JSON.stringify({
          event: "order_dispatched_received",
          orderId,
          restaurantId,
          prepTimeMs,
          timestamp: new Date().toISOString(),
        })
      );

      await sleep(prepTimeMs);

      const readyEvent = {
        orderId,
        restaurantId,
        status: "ready",
        preparedAt: new Date().toISOString(),
      };

      await publisher.publish(ORDER_READY_CHANNEL, JSON.stringify(readyEvent));

      jobsProcessed += 1;
      lastJobAt = new Date().toISOString();

      console.log(
        JSON.stringify({
          event: "order_ready_published",
          orderId,
          restaurantId,
          jobsProcessed,
          timestamp: lastJobAt,
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "prep_worker_error",
          error: error.message,
          rawMessage: message,
          timestamp: new Date().toISOString(),
        })
      );
    }
  });
}

// root route
app.get("/", (req, res) => {
  res.json({ message: "Preparation Tracker Worker is running" });
});

// temp health route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Worker is running",
    jobs_processed: jobsProcessed,
    last_job_at: lastJobAt,
  });
});

app.listen(PORT, async () => {
  console.log(`Preparation Tracker Worker listening on port ${PORT}`);

  try {
    await startWorker();
  } catch (error) {
    console.error("Failed to start Preparation Tracker Worker:", error.message);
  }
});