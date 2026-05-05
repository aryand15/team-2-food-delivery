// Sprint 4 — Replica Failure Test
// Run: docker compose exec holmes k6 run /workspace/k6/sprint-4-replica.js
// During the 120s sustained window, stop a replica: docker stop <container-id>

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errors = new Rate("errors");

const BASE_URL = __ENV.BASE_URL || "http://caddy:80";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "120s", target: 20 },
    { duration: "30s", target: 20 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    errors: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export default function () {
  const res = http.get(`${BASE_URL}/restaurant/restaurants`);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 1000ms": (r) => r.timings.duration < 1000,
  });

  errors.add(!ok);
  sleep(0.5);
}
