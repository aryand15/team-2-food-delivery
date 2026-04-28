import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const errors = new Rate("errors");

const goodOrders = new Counter("good_orders");
const poisonOrders = new Counter("poison_orders");

const dispatchPoison = new Counter("dispatch_poison_pills");
const notificationPoison = new Counter("notification_poison_pills");
const deliveryPoison = new Counter("delivery_poison_pills");
const prepPoison = new Counter("prep_poison_pills");
const surgePoison = new Counter("surge_poison_pills");

const goodSurgeEvents = new Counter("good_surge_events");
const healthChecks = new Counter("worker_health_checks");

const ORDER_URL = "http://order-service:3001/orders";

const DISPATCH_POISON_URL = "http://order-dispatch-worker:8080/poison-pill";
const NOTIFICATION_POISON_URL = "http://notification-worker:8081/inject-poison-pill";
const PREP_POISON_URL = "http://preparation-tracker-worker:8082/inject-poison-pill";
const DELIVERY_POISON_URL = "http://delivery-tracker-worker:3006/inject-poison-pill";

const SURGE_EVENTS_URL = "http://surge-pricing-worker:3005/events";
const SURGE_POISON_URL = "http://surge-pricing-worker:3005/inject-poison-pill";

const HEALTH_URLS = [
  "http://order-dispatch-worker:8080/health",
  "http://notification-worker:8081/health",
  "http://preparation-tracker-worker:8082/health",
  "http://surge-pricing-worker:3005/health",
  "http://delivery-tracker-worker:3006/health",
];

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "30s", target: 20 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    errors: ["rate<0.10"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

function validOrderPayload() {
  return JSON.stringify({
    clientOrderId: `good-${__VU}-${__ITER}-${Date.now()}`,
    restaurantId: "1",
    items: [{ menuItemId: "pizza", quantity: 2 }],
  });
}

function poisonOrderPayload() {
  return JSON.stringify({
    clientOrderId: `poison-${__VU}-${__ITER}-${Date.now()}`,
    restaurantId: "nonexistent-restaurant",
    items: [{ menuItemId: "pizza", quantity: 2 }],
  });
}

function validSurgeEventPayload() {
  return JSON.stringify({
    event_id: `surge-good-${__VU}-${__ITER}-${Date.now()}`,
    restaurant_id: 1,
    order_count: 12,
  });
}

function submitGoodOrder() {
  const res = http.post(ORDER_URL, validOrderPayload(), {
    headers: { "Content-Type": "application/json" },
  });

  const ok = check(res, {
    "good order accepted": (r) =>
      r.status === 200 || r.status === 201 || r.status === 202,
  });

  goodOrders.add(1);
  errors.add(!ok);
}

function submitPoisonOrder() {
  const res = http.post(ORDER_URL, poisonOrderPayload(), {
    headers: { "Content-Type": "application/json" },
  });

  const ok = check(res, {
    "poison order accepted into async pipeline": (r) =>
      r.status === 200 || r.status === 201 || r.status === 202,
  });

  poisonOrders.add(1);
  errors.add(!ok);
}

function injectDispatchPoison() {
  const payload = JSON.stringify({
    id: `dispatch-poison-${__VU}-${__ITER}-${Date.now()}`,
    restaurant_id: "bad-restaurant",
    items: [{ menuItemId: "pizza", quantity: 2 }],
  });

  const res = http.post(DISPATCH_POISON_URL, payload, {
    headers: { "Content-Type": "application/json" },
  });

  const ok = check(res, {
    "dispatch poison injected": (r) => r.status === 200 || r.status === 202,
  });

  dispatchPoison.add(1);
  errors.add(!ok);
}

function injectNotificationPoison() {
  const res = http.post(NOTIFICATION_POISON_URL, null);

  const ok = check(res, {
    "notification poison injected": (r) => r.status === 200 || r.status === 202,
  });

  notificationPoison.add(1);
  errors.add(!ok);
}

function injectPrepPoison() {
  const res = http.post(PREP_POISON_URL, null);

  const ok = check(res, {
    "prep poison injected": (r) => r.status === 200 || r.status === 202,
  });

  prepPoison.add(1);
  errors.add(!ok);
}

function injectDeliveryPoison() {
  const res = http.post(DELIVERY_POISON_URL, null);

  const ok = check(res, {
    "delivery poison injected": (r) => r.status === 200 || r.status === 202,
  });

  deliveryPoison.add(1);
  errors.add(!ok);
}

function submitGoodSurgeEvent() {
  const res = http.post(SURGE_EVENTS_URL, validSurgeEventPayload(), {
    headers: { "Content-Type": "application/json" },
  });

  const ok = check(res, {
    "good surge event accepted": (r) => r.status === 200 || r.status === 202,
  });

  goodSurgeEvents.add(1);
  errors.add(!ok);
}

function injectSurgePoison() {
  const res = http.post(SURGE_POISON_URL, "{broken surge event", {
    headers: { "Content-Type": "text/plain" },
  });

  const ok = check(res, {
    "surge poison injected": (r) => r.status === 200 || r.status === 202,
  });

  surgePoison.add(1);
  errors.add(!ok);
}

function checkHealth(url) {
  const res = http.get(url);

  const reachable = check(res, {
    [`${url} reachable`]: (r) => r.status === 200 || r.status === 503,
  });

  if (!reachable) {
    errors.add(true);
    return;
  }

  let body;
  try {
    body = res.json();
  } catch (_) {
    errors.add(true);
    return;
  }

  const ok = check(body, {
    [`${url} reports health data`]: (b) =>
      !!b &&
      (
        !!b.checks?.queue ||
        !!b.checks?.worker ||
        typeof b.queue_depth !== "undefined" ||
        typeof b.dlq_depth !== "undefined"
      ),
  });

  healthChecks.add(1);
  errors.add(!ok);
}

export default function () {
  const r = Math.random();

  if (r < 0.45) {
    submitGoodOrder();
  } else if (r < 0.57) {
    submitPoisonOrder();
  } else if (r < 0.67) {
    injectDispatchPoison();
  } else if (r < 0.75) {
    injectNotificationPoison();
  } else if (r < 0.83) {
    injectPrepPoison();
  } else if (r < 0.90) {
    injectDeliveryPoison();
  } else if (r < 0.96) {
    submitGoodSurgeEvent();
  } else {
    injectSurgePoison();
  }

  if (__ITER % 5 === 0) {
    for (const url of HEALTH_URLS) {
      checkHealth(url);
    }
  }

  sleep(0.5);
}