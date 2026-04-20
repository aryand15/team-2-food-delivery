# Sprint 2 Report — [Team Name]

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** [date, before 04.21 class]

---

## What We Built

- Cache: ...
- Queue and worker: We implemented the order queue and order dispatch worker. The async pipeline pushes an order to the order queue, which is received by the order dispatch worker. 
- Async pipeline: We use an async pipeline for the order queue. (See above.)

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Gianna      | notification worker, health endpoint, queue checks, documentation | 38ce8c2, 00311d3, 6694a85, 13f687f |
| Jada      | N/A | N/A |
| Phoebe      | N/A | N/A |
| Nivaan      | rating service, rating database, surge pricing worker, pricing database, health endpoints | 5f39d35, d727837 |
| Ashley      | redis consumer health endpoint, queue checks, pr #20, #22, #23 | 385902a, 2247eeb |
| Aryan      | postgres database, idempotent POST orders endpoint, env variable fix | 48201b4, 86e3ce4, f4b64a5 |
| Ayaan      | menu endpoint | 0974a5a | 
| Eva      | pr #18, #19, #21 | N/A |

---

## What Is Working

- [x] Redis cache in use — repeated reads do not hit the database
- [x] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [x] At least one write path is idempotent (same request twice produces same result)
- [x] Worker logs show pipeline activity in `docker compose logs`
- [x] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut

Still have not implemented actual functionality (still using placeholder data).

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change |
| ------ | ----------------- | --------------- | ------ |
| p50    | | | |
| p95    | | | |
| p99    | | | |
| RPS    | | | |

[Explain the improvement. If the numbers did not improve, explain why and what you did to diagnose it.]

### Test 2: Async Pipeline Burst (`k6/sprint-2-async.js`)

```
[Paste k6 summary output here]
```

Worker health during the burst (hit `/health` while k6 is running):

```json
[Paste an example health response showing non-zero queue depth]
```

Idempotency check: [Describe what you sent and what happened when you sent the same idempotency key twice.]

---

## Blockers and Lessons Learned
