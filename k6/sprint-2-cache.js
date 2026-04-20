import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");
const TARGET_URL = "http://restaurant-service:3003/restaurants/1/menu";

export const options = {
  stages: [
    { duration: "30s", target: 20 }, 
    { duration: "30s", target: 20 }, 
    { duration: "10s", target: 0 }, 
  ],
  thresholds: {
    errors: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export default function () {
  const res = http.get(TARGET_URL);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "body is non-empty": (r) => r.body && r.body.length > 0,
  });

  errorRate.add(!ok);
  sleep(0.5);
}