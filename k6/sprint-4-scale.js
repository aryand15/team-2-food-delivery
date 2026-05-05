import http from 'k6/http'
import { Rate } from 'k6/metrics';
import { check, sleep } from 'k6'
const errors = new Rate("errors");

// Run with: k6 run --env SCALE=single k6/sprint-4-scale.js
// Run with: k6 run --env SCALE=replicated k6/sprint-4-scale.js

const BASE_URL = __ENV.BASE_URL || 'http://caddy:80'
const TARGET_PATH = __ENV.TARGET_PATH || "/restaurant/restaurants/1/menu";


export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '60s', target: 50 }, // push harder than Sprint 1 to show scaling benefit
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(90)", "p(95)", "p(99)"],
}

export default function () {
  const res = http.get(`${BASE_URL}${TARGET_PATH}`);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "body is non-empty": (r) => r.body && r.body.length > 0,
  });

  errors.add(!ok);
  sleep(0.5);
}
