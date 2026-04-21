import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const errorRate = new Rate("errors");
const acceptedWrites = new Counter("accepted_writes");
const duplicateChecks = new Counter("duplicate_checks");
const workerHealthChecks = new Counter("worker_health_checks");

const ORDER_URL = "http://order-service:3001/orders";
const WORKER_HEALTH_URL = "http://order-dispatch-worker:8080/health";

export const options = {
  scenarios: {
    burst_writes: {
      executor: "per-vu-iterations",
      vus: 50,
      iterations: 1,
      maxDuration: "30s",
      exec: "submitOrders",
    },
    duplicate_idempotency_check: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "2s",
      maxDuration: "15s",
      exec: "checkDuplicateHandling",
    },
    worker_health_polling: {
      executor: "constant-vus",
      vus: 1,
      duration: "20s",
      startTime: "1s",
      exec: "pollWorkerHealth",
    },
  },
  thresholds: {
    errors: ["rate<0.05"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export function submitOrders() {
  const uniqueId = `order-${__VU}-${__ITER}-${Date.now()}`;

  const payload = JSON.stringify({
    clientOrderId: uniqueId,
    restaurantId: "3932",
    items: [
      {
        menuItemId: "pizza",
        quantity: 2,
      },
    ],
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const res = http.post(ORDER_URL, payload, params);

  const accepted = check(res, {
    "new order returns 201": (r) => r.status === 201,
  });

  if (accepted) {
    acceptedWrites.add(1);
  }
  errorRate.add(!accepted);
}

export function checkDuplicateHandling() {
  const duplicateId = `duplicate-test-${Date.now()}`;

  const payload = JSON.stringify({
    clientOrderId: duplicateId,
    restaurantId: "3932",
    items: [
      {
        menuItemId: "pizza",
        quantity: 2,
      },
    ],
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const first = http.post(ORDER_URL, payload, params);
  const second = http.post(ORDER_URL, payload, params);

  const firstOk = check(first, {
    "first duplicate test request returns 201": (r) => r.status === 201,
  });

  const secondOk = check(second, {
    "second duplicate test request returns 200": (r) => r.status === 200,
  });

  let sameStoredOrder = true;

  try {
    const firstBody = first.json();
    const secondBody = second.json();

    if (
      firstBody &&
      secondBody &&
      firstBody.order &&
      secondBody.order &&
      firstBody.order.idempotency_key &&
      secondBody.order.idempotency_key
    ) {
      sameStoredOrder =
        firstBody.order.idempotency_key === secondBody.order.idempotency_key;
    }
  } catch (_) {
    sameStoredOrder = true;
  }

  const duplicateHandled = check(
    { firstOk, secondOk, sameStoredOrder },
    {
      "duplicate request handled correctly": (obj) =>
        obj.firstOk && obj.secondOk && obj.sameStoredOrder,
    }
  );

  duplicateChecks.add(1);
  errorRate.add(!duplicateHandled);
}

export function pollWorkerHealth() {
  const res = http.get(WORKER_HEALTH_URL);

  const reachable = check(res, {
    "worker health endpoint reachable": (r) => r.status === 200 || r.status === 503,
  });

  if (!reachable) {
    errorRate.add(true);
    sleep(1);
    return;
  }

  let parsed = null;
  try {
    parsed = res.json();
  } catch (_) {
    errorRate.add(true);
    sleep(1);
    return;
  }

  const ok = check(parsed, {
    "worker health has checks": (b) => !!b.checks,
    "worker health has queue info": (b) =>
      !!b.checks && !!b.checks.queue && typeof b.checks.queue.depth !== "undefined",
    "worker health has dlq info": (b) =>
      !!b.checks && !!b.checks.queue && typeof b.checks.queue.dlq_depth !== "undefined",
    "worker health has worker info": (b) =>
      !!b.checks && !!b.checks.worker && typeof b.checks.worker.jobs_processed !== "undefined",
    "worker health reports last_job_at": (b) =>
      !!b.checks && !!b.checks.worker && typeof b.checks.worker.last_job_at !== "undefined",
  });

  workerHealthChecks.add(1);
  errorRate.add(!ok);

  sleep(1);
}

export default function () {
  sleep(1);
}