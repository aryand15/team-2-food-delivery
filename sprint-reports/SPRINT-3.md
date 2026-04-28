# Sprint 3 Report — [Team Name]

**Sprint:** 3 — Reliability and Poison Pills  
**Tag:** `sprint-3`  
**Submitted:** [date, before 04.28 class]

---

## What We Built

The system now handles poison-pill failures where workers receive malformed or invalid messages that cannot be processed. The workers catch  bad messages and route them into a dead letter queue (DLQ) and continue to processing normal traffic. DLQ handling was added for orders:queue, notifications:queue, prep:queue, deliveries:queue, and orders:volume. When a poison pill is injected the worker removes it from the main queue, detects that it is invalid, and then pushes it into the DLQ. The /health endpoint is updated such that the dlq_depth becomes bigger than zero while the worker continues to be healthy and good requests keep flowing through.
---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Phoebe      | DLQ handling for delivery tracker worker (parse errors + missing `id` → `deliveries:queue:dlq`), `POST /inject-poison-pill` endpoint | 000e2f2, 3ea9d5c |
| Eva      | k6 testing, fixes for workers, docs | 777604d |
| Jada    | preparation worker poison pill & dlq handling | fe5e066, 0e8cb17, ac5626f |
| Gianna    | notification worker poison pill & dlq handling | 3fe1257, 67cbd69|
| Aryan    | implement db & functionality to order service | 00c9d60 |
| Ashley    | order dispatch worker poison pill & dlq handling | 23177f3, 5073615, |
| Nivaan    | surge pricing poison pill, implement db & functionality | d39f562, a8b7359 |
| Ayaan    | N/A | N/A |



---

## What Is Working

- [ ] Poison pill handling: malformed messages go to DLQ, worker keeps running
- [ ] Worker `GET /health` shows non-zero `dlq_depth` after poison pills are injected
- [ ] Worker status remains `healthy` while DLQ fills
- [ ] System handles failure scenarios gracefully (no dangling state, no crash loops)
- [ ] All services/workers required for team size are implemented

---

## What Is Not Working / Cut

Everything we aimed to complete in Sprint 3 is working correctly. Moving forward we still need to scale at least three services using docker compose up --scale, ensure all replicas stay healthy, and confirm the load balancer distributes requests across instances. We also need to verify that the full system is completely connected end to end. Some services may still be using placeholder data so we need to confirm that all components are fully using databases.

## Poison Pill Demonstration

How to inject a poison pill:

```bash
# From inside holmes:
docker compose exec holmes bash

# Example — publish a malformed message directly to the queue:
redis-cli -h redis RPUSH your-queue '{"this": "is malformed"}'
```

Worker health before injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 0,
  "last_job_at": "2025-04-24T..."
}
```

Worker health after injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 3,
  "last_job_at": "2025-04-24T..."
}
```

---

## k6 Results: Poison Pill Resilience (`k6/sprint-3-poison.js`)

```

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 


     execution: local
        script: /workspace/k6/sprint-3-poison.js
        output: -

     scenarios: (100.00%) 1 scenario, 20 max VUs, 1m40s max duration (incl. graceful stop):
              * default: Up to 20 looping VUs for 1m10s over 3 stages (gracefulRampDown: 30s, gracefulStop: 30s)



  █ THRESHOLDS 

    errors
    ✓ 'rate<0.10' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 5993    85.460049/s
    checks_succeeded...: 100.00% 5993 out of 5993
    checks_failed......: 0.00%   0 out of 5993

    ✓ poison order accepted into async pipeline
    ✓ http://order-dispatch-worker:8080/health reachable
    ✓ http://order-dispatch-worker:8080/health reports health data
    ✓ http://notification-worker:8081/health reachable
    ✓ http://notification-worker:8081/health reports health data
    ✓ http://preparation-tracker-worker:8082/health reachable
    ✓ http://preparation-tracker-worker:8082/health reports health data
    ✓ http://surge-pricing-worker:3005/health reachable
    ✓ http://surge-pricing-worker:3005/health reports health data
    ✓ http://delivery-tracker-worker:3006/health reachable
    ✓ http://delivery-tracker-worker:3006/health reports health data
    ✓ dispatch poison injected
    ✓ good order accepted
    ✓ delivery poison injected
    ✓ good surge event accepted
    ✓ notification poison injected
    ✓ surge poison injected
    ✓ prep poison injected

    CUSTOM
    delivery_poison_pills..........: 129    1.839537/s
    dispatch_poison_pills..........: 179    2.552536/s
    errors.........................: 0.00%  0 out of 3983
    good_orders....................: 883    12.591561/s
    good_surge_events..............: 119    1.696937/s
    notification_poison_pills......: 154    2.196037/s
    poison_orders..................: 262    3.736114/s
    prep_poison_pills..............: 155    2.210297/s
    surge_poison_pills.............: 92     1.311918/s
    worker_health_checks...........: 2010   28.662556/s

    HTTP
    http_req_duration..............: avg=4.5ms    min=447.25µs med=2.36ms   max=327.56ms p(90)=6.98ms p(95)=11.66ms  p(99)=38.94ms 
      { expected_response:true }...: avg=4.5ms    min=447.25µs med=2.36ms   max=327.56ms p(90)=6.98ms p(95)=11.66ms  p(99)=38.94ms 
    http_req_failed................: 0.00%  0 out of 3983
    http_reqs......................: 3983   56.797493/s

    EXECUTION
    iteration_duration.............: avg=511.76ms min=500.86ms med=505.99ms max=829.94ms p(90)=522ms  p(95)=535.35ms p(99)=612.85ms
    iterations.....................: 1973   28.134937/s
    vus............................: 1      min=1         max=20
    vus_max........................: 20     min=20        max=20

    NETWORK
    data_received..................: 2.1 MB 30 kB/s
    data_sent......................: 605 kB 8.6 kB/s




running (1m10.1s), 00/20 VUs, 1973 complete and 0 interrupted iterations
default ✓ [======================================] 00/20 VUs  1m10s
```

| Metric     | Normal-only run | Mixed with poison pills | Change       |
| ---------- | --------------- | ----------------------- | ------------ |
| p95        | 7.68 ms         | 9.57 ms                 | +1.89 ms    |
| RPS        | 57.09 req/s     | 56.65 req/s             | -0.44 req/s |
| Error rate | 0.00%           | 0.00%                   | no change    |


Throughput held steady even with poison pills. The mixed run dropped only slightly from 57.09 req/s to 56.65 req/s, and the error rate stayed at 0.00%. The p95 latency increased from 7.68 ms to 9.57 ms which makes sense since the mixed test does more work by injecting poison pills and checking worker health but the increase is still small. All worker health checks passed so the workers stayed healthy while routing bad messages to the DLQs properly.
---

## Blockers and Lessons Learned

Our biggest blockers was coordinating changes across multiple services and workers at the same time, since one missing endpoint, wrong queue name, or incorrect port could break communication between everyone. We also ran into debugging issues with health checks and poison pill routing. A major lesson learned was the importance of testing each service independently before testing the full pipeline. 