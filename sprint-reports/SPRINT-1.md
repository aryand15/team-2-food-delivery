# Sprint 1 Report — Team 2

**Sprint:** 1 — Foundation  
**Tag:** `sprint-1`  
**Submitted:** 04.15.2026

---

## What We Built

Three microservices — `order-service`, `driver-service`, and `restaurant-service` — each with its own Express/Node.js app, its own Postgres database, and a shared Redis instance. Every service has a `GET /health` endpoint that checks both Postgres and Redis and reports their status.

`docker compose up` starts everything together. The `order-service` makes a live HTTP call to `driver-service` at `GET /get-drivers`, which is our working service-to-service call. The `restaurant-service` exposes `GET /restaurants`, which is the endpoint the k6 test targets.

---

## Individual Contributions

| Team Member | What They Delivered                                                              | Files / Dirs                              | Key Commits / PRs              |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| Aryan       | order-service boilerplate, Dockerfile, health endpoint, `/get-drivers` sync call | `order/server.js`, `order/Dockerfile`, `order/package.json` | f31a317, ec5f56d, b273346, PRs #9–#11, #13 |
| Eva         | compose.yml wiring all services, databases, and Redis                            | `compose.yml`                             | b25a95a                        |
| Gianna      | driver-service server logic, health endpoint, Dockerfile fix                     | `driver/driver.js`, `driver/Dockerfile`   | 5935160, 5c43d94, PR #8        |
| Nivan       | driver-service Postgres + Redis setup, PR reviews                                | `driver/driver.js`, `driver/Dockerfile`   | 6dd0af8, PR #7                 |
| Ayaan       | restaurant-service health endpoint                                               | `restaurant/restaurant.js`                | 59e6bff, 689fa05, PR #12       |
| Jada        | restaurant-service scaffold, `/restaurants` and `/health` routes                 | `restaurant/restaurant.js`, `restaurant/package.json` | 1244ed5, a2633c5   |
| Ashley      | order-service health endpoint (initial implementation, reverted, reimplemented)  | `order/server.js`                         | a558672, 504c9e8, PRs #1–2, #5 |
| Phoebe      | k6 baseline script, sprint report                                                | `k6/sprint-1.js`, `sprint-reports/SPRINT-1.md` | (this PR)                 |

Verify with:

```bash
git log --author="Aryan" --oneline -- order/
git log --author="Ashley" --oneline -- order/
git log --author="Gianna" --oneline -- driver/
git log --author="nivaan" --oneline -- driver/
git log --author="Ayaan" --oneline -- restaurant/
git log --author="Jada" --oneline -- restaurant/
git log --author="Eva" --oneline -- compose.yml
git log --author="Phoebe" --oneline -- k6/
```

---

## What Is Working

- [x] `docker compose up` starts all services without errors
- [x] `GET /health` on every service returns `200` with DB and Redis status
- [x] At least one synchronous service-to-service call works end-to-end (`order-service` → `driver-service`)
- [x] k6 baseline test runs with 0 errors, all thresholds pass

---

## What Is Not Working / Cut

- `docker compose ps` was showing `order-service` and `restaurant-service` as `(unhealthy)`. The issue was that `curl` was not installed in those Node images, so Docker's internal healthcheck failed even though both services respond correctly. Fixed by adding `RUN apk add --no-cache curl` to the Dockerfiles.
- `GET /restaurants` returns hardcoded placeholder data, not real database rows. Proper DB-backed routes are planned for Sprint 2.
- `preparation-tracker`, `delivery-tracker`, `order-dispatch`, and `notification-worker` were not started this sprint. Sprint 1 focused on starting the three core services.

---

## k6 Baseline Results

Script: `k6/sprint-1.js`  
Run: `docker compose exec holmes k6 run /workspace/k6/sprint-1.js`  
Target: `GET http://restaurant-service:3003/restaurants` — 20 VUs, 30s ramp-up → 30s sustain → 10s ramp-down

```
  █ THRESHOLDS

    errors
    ✓ 'rate<0.01' rate=0.00%

    http_req_duration
    ✓ 'p(50)<500' p(50)=1.61ms
    ✓ 'p(95)<500' p(95)=2.95ms
    ✓ 'p(99)<500' p(99)=3.67ms


  █ TOTAL RESULTS

    checks_total.......: 4006    57.14/s
    checks_succeeded...: 100.00% 4006 out of 4006
    checks_failed......: 0.00%   0 out of 4006

    ✓ status is 200
    ✓ response time < 500ms

    HTTP
    http_req_duration..............: avg=1.68ms  min=184.54µs  med=1.61ms  max=6.8ms  p(90)=2.61ms  p(95)=2.95ms
    http_req_failed................: 0.00%  0 out of 2003
    http_reqs......................: 2003   28.57/s
```

| Metric             | Value   |
| ------------------ | ------- |
| p50 response time  | 1.61 ms |
| p95 response time  | 2.95 ms |
| p99 response time  | 3.67 ms |
| Requests/sec (avg) | 28.57   |
| Error rate         | 0.00%   |

**What these numbers mean:**

p50 at 1.61 ms means the typical request finishes in well under 2 ms. p95 and p99 at 2.95 ms and 3.67 ms show that even the slowest requests stay fast — there are no spikes or stalls at the tail. The 28.57 req/s throughput is expected: each of the 20 VUs sleeps 0.5s between requests, so roughly 2 req/s per VU minus ramp time gives ~28 req/s net. Zero errors across all 2003 requests.

These are our baseline numbers. Sprint 2 Redis caching on `/restaurants` should push latency lower and throughput higher.

---

## Blockers and Lessons Learned

- **Curl not in the Node images**: We did not notice the `(unhealthy)` status in `docker compose ps`. The services respond fine from outside, but Docker's internal healthcheck can't run because `curl` isn't installed. Adding it to the Dockerfiles fixed the issue.
- **Reverted health endpoint**: The order-service health endpoint had to be reverted mid-sprint due to a branch conflict and was re-implemented shortly after. Smaller, more focused PRs would help avoid this in the future.
- **Placeholder data**: We underestimated how much time proper DB schema design takes, so we shipped hardcoded data for `/restaurants` to avoid blocking the rest of the system. Real routes are the first priority in Sprint 2.