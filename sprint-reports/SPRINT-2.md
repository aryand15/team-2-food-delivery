# Sprint 2 Report — [Team Name]

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** [date, before 04.21 class]

---

## What We Built

- Cache: We cache the menu items in the restaurant service.
- Queue and worker: We implemented the order queue and order dispatch worker. The async pipeline pushes an order to the order queue, which is received by the order dispatch worker. 
- Async pipeline: We use an async pipeline for the order queue. (See above.)

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Gianna      | notification worker, health endpoint, queue checks, documentation | 38ce8c2, 00311d3, 6694a85, 13f687f, bb39331 |
| Jada      | preparation tracker worker, health endpoint, queue checks | 35295b9, 0b54e36, 845728b |
| Phoebe      | delivery-tracker-worker service, health endpoint, Dockerfile fix | b6e883e, 3ef52b9, a729ebc |
| Nivaan      | rating service, rating database, surge pricing worker, pricing database, health endpoints | 5f39d35, d727837 |
| Ashley      | redis consumer health endpoint, queue checks, pr #20, #22, #23 | 385902a, 2247eeb |
| Aryan      | postgres database, idempotent POST orders endpoint, env variable fix | 48201b4, 86e3ce4, f4b64a5 |
| Ayaan      | menu endpoint | 0974a5a | 
| Eva      | k6 tests, pr #18, #19, #21 | 2ae0fdd, 648fb4a, 69a8a9f |

---

## What Is Working

- [x] Redis cache in use — repeated reads do not hit the database
- [x] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [x] At least one write path is idempotent (same request twice produces same result)
- [x] Worker logs show pipeline activity in `docker compose logs`
- [x] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut

Still have not implemented actual functionality (still using placeholder data). Also, some of our services are using databases, and others are not. We will add databases for all services in future sprints.

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change |
| ------ | ----------------- | --------------- | ------ |
| p50    | 3.13 ms | 2.97 ms | -0.16 ms |
| p95    | 5.85 ms | 4.89 ms | -1.16ms |
| p99    | 10.14 ms | 7.00 ms | -3.14 ms |
| RPS    | 28.43 req/s | 28.42 req/s | No change. |

[Explain the improvement. If the numbers did not improve, explain why and what you did to diagnose it.]

### Test 2: Async Pipeline Burst (`k6/sprint-2-async.js`)

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 


     execution: local
        script: /workspace/k6/sprint-2-async.js
        output: -

     scenarios: (100.00%) 3 scenarios, 52 max VUs, 1m0s max duration (incl. graceful stop):
              * burst_writes: 1 iterations for each of 50 VUs (maxDuration: 30s, exec: submitOrders, gracefulStop: 30s)
              * worker_health_polling: 1 looping VUs for 20s (exec: pollWorkerHealth, startTime: 1s, gracefulStop: 30s)
              * duplicate_idempotency_check: 1 iterations shared among 1 VUs (maxDuration: 15s, exec: checkDuplicateHandling, startTime: 2s, gracefulStop: 30s)



  █ THRESHOLDS 

    errors
    ✓ 'rate<0.05' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 65      2.297159/s
    checks_succeeded...: 100.00% 65 out of 65
    checks_failed......: 0.00%   0 out of 65

    ✓ new order returns 201
    ✓ first duplicate test request returns 201
    ✓ second duplicate test request returns 200
    ✓ duplicate request handled correctly
    ✓ worker health endpoint reachable
    ✓ worker health has checks
    ✓ worker health has queue info
    ✓ worker health has dlq info
    ✓ worker health has worker info
    ✓ worker health reports last_job_at

    CUSTOM
    accepted_writes................: 50    1.767045/s
    duplicate_checks...............: 1     0.035341/s
    errors.........................: 0.00% 0 out of 53
    worker_health_checks...........: 2     0.070682/s

    HTTP
    http_req_duration..............: avg=544.06ms min=6.51ms  med=71.87ms max=14.16s p(90)=113.06ms p(95)=114.53ms p(99)=12.53s
      { expected_response:true }...: avg=544.06ms min=6.51ms  med=71.87ms max=14.16s p(90)=113.06ms p(95)=114.53ms p(99)=12.53s
    http_req_failed................: 0.00% 0 out of 54
    http_reqs......................: 54    1.908409/s

    EXECUTION
    iteration_duration.............: avg=594.98ms min=20.62ms med=74.42ms max=15.16s p(90)=115.11ms p(95)=117.01ms p(99)=13.58s
    iterations.....................: 53    1.873068/s
    vus............................: 1     min=0       max=1 
    vus_max........................: 52    min=52      max=52

    NETWORK
    data_received..................: 31 kB 1.1 kB/s
    data_sent......................: 13 kB 458 B/s




running (0m28.3s), 00/52 VUs, 53 complete and 0 interrupted iterations
burst_writes                ✓ [======================================] 50 VUs  00.1s/30s  50/50 iters, 1 per VU
worker_health_polling       ✓ [======================================] 1 VUs   20s       
duplicate_idempotency_check ✓ [======================================] 1 VUs   00.0s/15s  1/1 shared iters```

Worker health during the burst (hit `/health` while k6 is running):

```json
{
"status": "healthy",
"service": "order-dispatch-worker",
"timestamp": "2026-04-21T01:24:37.190Z",
"uptime_seconds": 86,
"checks": {
"redis": {
"status": "healthy",
"latency_ms": 103
},
"queue": {
"status": "healthy",
"depth": 48,
"dlq_depth": 0
},
"worker": {
"status": "healthy",
"last_job_at": "2026-04-21T01:24:36.255Z",
"jobs_processed": 1,
"seconds_since_last_job": 0.935
}
}
}
```

Idempotency check: We sent the same order payload twice using the same clientOrderId which functions as the idempotency key in our code. The payload includes clientOrderId, restaurantId, and items array in both requests. The first request returned 201 Created which means the order was inserted into the database and accepted for queueing. The second request returned 200 OK which means the service recognized the duplicate key and returned the already stored order instead of creating a new one.

---

## Blockers and Lessons Learned

We learned that we should start our work early since there are so many dependencies in these Sprints. It is much easier to work incrementally through the week rather than all at once. Also asking for help from our teammates is a lesson we all learned when we were struggling instead of taking longer periods of time to complete tasks.
