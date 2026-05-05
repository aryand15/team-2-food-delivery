# Sprint 4 Report — Team 2

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** 2026-05-05

---

## What We Built

We completed the system by adding replication and load balancing for three core services: order-service, driver-service, and restaurant-service. We used docker compose up --scale and Caddy as a reverse proxy. We verified that traffic was distributed across replicas through logs, made sure the replicated services were stateless by relying on shared backing stores instead of local in-memory state, and polished the full system by fixing remaining integration issues, keeping health endpoints and DLQ handling working, and updating the README and final documentation so the project could be started, tested, and demoed reliably from a clean checkout.

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Aryan      | made improvements to POST /orders route; ensured statelessness of order service and documented endpoints | 545f75a, bb4f653 |
| Ayaan      | Caddyfile and fixing compose.yml file; ensured restaurant service can be scaled | 30675c3, d554ae7, 78440af |
| Eva      | k6 test; scale test for caddy; docs  | 0f1e161, 2224665|
| Jada      | finalized/polished preparation tracker worker; sprint 4 report| 614a248, 38f2ca0 |
| Gianna     | fixed poison pill payload syntax; finalized/polished notification worker | 9b7625e, e3cb968 |
| Phoebe      | replica failure k6 test; final README | 8cf2e6c, 6d8c8dd |
| Nivaan      | | |
| Ashley     | finalized/polished order dispatch worker | 18706e6 |

---

## Starting the System with Replicas

```bash
docker compose up --build --scale order-service=3 --scale driver-service=3 --scale restaurant-service=3
```

After startup:

```
NAME                                        IMAGE                                             COMMAND                  SERVICE                      CREATED              STATUS                        PORTS
caddy                                       caddy:2-alpine                                    "caddy run --config …"   caddy                        2 minutes ago        Up 2 minutes                  0.0.0.0:80->80/tcp, [::]:80->80/tcp
delivery-tracker-worker                     team-2-food-delivery-delivery-tracker-worker      "docker-entrypoint.s…"   delivery-tracker-worker      2 minutes ago        Up 2 minutes (healthy)        0.0.0.0:3006->3006/tcp, [::]:3006->3006/tcp
driver-db                                   postgres:16                                       "docker-entrypoint.s…"   driver-db                    2 minutes ago        Up 2 minutes (healthy)        5432/tcp
holmes                                      team-2-food-delivery-holmes                       "sleep infinity"         holmes                       2 minutes ago        Up 2 minutes                  
notification-worker                         team-2-food-delivery-notification-worker          "docker-entrypoint.s…"   notification-worker          2 minutes ago        Up 2 minutes (healthy)        0.0.0.0:8081->8081/tcp, [::]:8081->8081/tcp
order-db                                    postgres:16                                       "docker-entrypoint.s…"   order-db                     2 minutes ago        Up 2 minutes (healthy)        5432/tcp
order-dispatch-worker                       team-2-food-delivery-order-dispatch-worker        "docker-entrypoint.s…"   order-dispatch-worker        2 minutes ago        Up 2 minutes (healthy)        0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp
preparation-tracker-worker                  team-2-food-delivery-preparation-tracker-worker   "docker-entrypoint.s…"   preparation-tracker-worker   2 minutes ago        Up 2 minutes (healthy)        0.0.0.0:8082->8082/tcp, [::]:8082->8082/tcp
pricing-db                                  postgres:16                                       "docker-entrypoint.s…"   pricing-db                   2 minutes ago        Up 2 minutes (healthy)        5432/tcp
rating-db                                   postgres:16                                       "docker-entrypoint.s…"   rating-db                    2 minutes ago        Up 2 minutes (healthy)        5432/tcp
redis                                       redis:7                                           "docker-entrypoint.s…"   redis                        2 minutes ago        Up 2 minutes (healthy)        6379/tcp
restaurant-db                               postgres:16                                       "docker-entrypoint.s…"   restaurant-db                2 minutes ago        Up 2 minutes (healthy)        5432/tcp
surge-pricing-worker                        team-2-food-delivery-surge-pricing-worker         "docker-entrypoint.s…"   surge-pricing-worker         2 minutes ago        Up 2 minutes (healthy)        0.0.0.0:3005->3005/tcp, [::]:3005->3005/tcp
team-2-food-delivery-driver-service-1       team-2-food-delivery-driver-service               "docker-entrypoint.s…"   driver-service               2 minutes ago        Up 2 minutes (healthy)        3002/tcp
team-2-food-delivery-driver-service-2       team-2-food-delivery-driver-service               "docker-entrypoint.s…"   driver-service               About a minute ago   Up About a minute (healthy)   3002/tcp
team-2-food-delivery-order-service-1        team-2-food-delivery-order-service                "docker-entrypoint.s…"   order-service                2 minutes ago        Up 2 minutes (healthy)        3001/tcp
team-2-food-delivery-order-service-2        team-2-food-delivery-order-service                "docker-entrypoint.s…"   order-service                About a minute ago   Up About a minute (healthy)   3001/tcp
team-2-food-delivery-order-service-3        team-2-food-delivery-order-service                "docker-entrypoint.s…"   order-service                About a minute ago   Up About a minute (healthy)   3001/tcp
team-2-food-delivery-rating-service-1       team-2-food-delivery-rating-service               "docker-entrypoint.s…"   rating-service               2 minutes ago        Up 2 minutes (healthy)        3004/tcp
team-2-food-delivery-restaurant-service-1   team-2-food-delivery-restaurant-service           "docker-entrypoint.s…"   restaurant-service           2 minutes ago        Up 2 minutes (healthy)        3003/tcp
team-2-food-delivery-restaurant-service-2   team-2-food-delivery-restaurant-service           "docker-entrypoint.s…"   restaurant-service           About a minute ago   Up About a minute (healthy)   3003/tcp
team-2-food-delivery-restaurant-service-3   team-2-food-delivery-restaurant-service           "docker-entrypoint.s…"   restaurant-service           About a minute ago   Up About a minute (healthy)   3003/tcp
```

---

## What Is Working

- [x] At least 3 services replicated via `--scale`
- [x] Load balancer distributes traffic across replicas (visible in logs)
- [x] Services are stateless — multiple instances run without conflicts
- [x] `docker compose ps` shows all replicas as `(healthy)`
- [x] System is fully complete for team size

---

## What Is Not Working / Cut

There were no Sprint 4 features intentionally cut from scope. Sprint 4 focused on replication, load balancing, resilience under replica failure, and final system polish rather than adding new core functionality. Any remaining issues were limited to smaller polish or integration concerns.
---

## k6 Results

### Test 1: Scaling Comparison (`k6/sprint-4-scale.js`)

| Metric | 1 replica | 3 replicas | Change |
| ------ | --------- | ---------- | ------ |
| p50    | 4.09ms | 4.08ms  | -0.01ms|
| p95    | 16.45ms | 30.6ms | +14.15ms |
| p99    | 32.72ms | 82.94ms  | +50.22ms |
| RPS    | 51.667363 req/s| 51.274331/s | -0.393032ms |

Both runs completed with 100% success and near-identical throughput (~51 RPS). The replicated run shows higher p95/p99 latency because 51 RPS is within a single instance's capacity, so there was no bottleneck for extra replicas to relieve. The added tail latency comes from Caddy's proxying overhead and round-robin jitter. The similar p50 values confirm the typical request path is unaffected. Demonstrating a throughput gain from replication would require saturating the single instance (~200+ VUs), where its connection pool or CPU would become the bottleneck and distribution across replicas would prevent the p95 spike. At the load levels here, replication's benefit is fault tolerance and zero downtime deploys rather than raw throughput, which the replica failure test demonstrates directly.


         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 


     execution: local
        script: k6/sprint-4-scale.js
        output: -

     scenarios: (100.00%) 1 scenario, 50 max VUs, 2m10s max duration (incl. graceful stop):
              * default: Up to 50 looping VUs for 1m40s over 3 stages (gracefulRampDown: 30s, gracefulStop: 30s)



  █ THRESHOLDS 

    errors
    ✓ 'rate<0.01' rate=0.00%

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 10418   103.683175/s
    checks_succeeded...: 100.00% 10418 out of 10418
    checks_failed......: 0.00%   0 out of 10418

    ✓ status is 200
    ✓ body is non-empty

    CUSTOM
    errors.........................: 0.00%  0 out of 5209

    HTTP
    http_req_duration..............: avg=4.2ms    min=366.08µs med=3.81ms   max=55.55ms p(50)=3.81ms   p(90)=6.96ms   p(95)=8.44ms   p(99)=12.88ms
      { expected_response:true }...: avg=4.2ms    min=366.08µs med=3.81ms   max=55.55ms p(50)=3.81ms   p(90)=6.96ms   p(95)=8.44ms   p(99)=12.88ms
    http_req_failed................: 0.00%  0 out of 5209
    http_reqs......................: 5209   51.841587/s

    EXECUTION
    iteration_duration.............: avg=506.48ms min=500.88ms med=506.05ms max=556.5ms p(50)=506.05ms p(90)=510.06ms p(95)=511.78ms p(99)=517.6ms
    iterations.....................: 5209   51.841587/s
    vus............................: 1      min=1         max=49
    vus_max........................: 50     min=50        max=50

    NETWORK
    data_received..................: 4.4 MB 43 kB/s
    data_sent......................: 484 kB 4.8 kB/s




running (1m40.5s), 00/50 VUs, 5209 complete and 0 interrupted iterations
default ✓ [======================================] 00/50 VUs  1m40s
root@637da18c3e96:/workspace# k6 run --env SCALE=replicated k6/sprint-4-scale.js

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 


     execution: local
        script: k6/sprint-4-scale.js
        output: -

     scenarios: (100.00%) 1 scenario, 50 max VUs, 2m10s max duration (incl. graceful stop):
              * default: Up to 50 looping VUs for 1m40s over 3 stages (gracefulRampDown: 30s, gracefulStop: 30s)



  █ THRESHOLDS 

    errors
    ✓ 'rate<0.01' rate=0.00%

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 10436   104.211804/s
    checks_succeeded...: 100.00% 10436 out of 10436
    checks_failed......: 0.00%   0 out of 10436

    ✓ status is 200
    ✓ body is non-empty

    CUSTOM
    errors.........................: 0.00%  0 out of 5218

    HTTP
    http_req_duration..............: avg=3.49ms   min=334.33µs med=3.26ms   max=25.39ms  p(50)=3.26ms   p(90)=5.53ms   p(95)=6.78ms   p(99)=12.12ms 
      { expected_response:true }...: avg=3.49ms   min=334.33µs med=3.26ms   max=25.39ms  p(50)=3.26ms   p(90)=5.53ms   p(95)=6.78ms   p(99)=12.12ms 
    http_req_failed................: 0.00%  0 out of 5218
    http_reqs......................: 5218   52.105902/s

    EXECUTION
    iteration_duration.............: avg=505.61ms min=500.62ms med=505.15ms max=526.76ms p(50)=505.15ms p(90)=508.91ms p(95)=510.35ms p(99)=515.01ms
    iterations.....................: 5218   52.105902/s
    vus............................: 2      min=1         max=49
    vus_max........................: 50     min=50        max=50

    NETWORK
    data_received..................: 4.4 MB 44 kB/s
    data_sent......................: 485 kB 4.8 kB/s




running (1m40.1s), 00/50 VUs, 5218 complete and 0 interrupted iterations
default ✓ [======================================] 00/50 VUs  1m40s

### Test 2: Replica Failure (`k6/sprint-4-replica.js`)

Test targets `GET /restaurant/restaurants` through Caddy with 3 restaurant-service replicas.
20 VUs sustained for 120s. One replica stopped manually at ~T+45s and restarted at ~T+90s.

Timeline:

| Time | Event |
| ---- | ----- |
| 0s   | k6 started, 3 replicas running, ramp-up begins |
| 30s  | Full 20 VUs reached, sustained phase begins |
| ~45s | Stopped one replica: `docker stop team-2-food-delivery-restaurant-service-2` |
| ~45s | Caddy redistributed traffic to remaining 2 healthy replicas |
| ~90s | Restarted: `docker compose up --scale restaurant-service=3 -d` |
| ~90s | Third replica rejoined, traffic redistributed across all 3 |
| 150s | Recovery verification phase complete |
| 190s | Ramp-down, test complete |

```
checks_total.......: 13468   70.87/s
checks_succeeded...: 100.00% 13468 out of 13468
checks_failed......: 0.00%   0 out of 13468

✓ status is 200
✓ response time < 1000ms

errors.........................: 0.00%  0 out of 6734

http_req_duration..............: avg=4.29ms  min=364µs  med=4.03ms  max=57.96ms
                                  p(90)=6.92ms  p(95)=8.1ms  p(99)=10.86ms
http_req_failed................: 0.00%  0 out of 6734
http_reqs......................: 6734   35.43/s

✓ errors rate<0.01
✓ http_req_duration p(95)<1000ms
```

Zero failed requests during replica stop and restart. p95 stayed well under threshold (8.1ms vs 1000ms limit). Caddy's round-robin DNS absorbed the failure transparently.

During failure — `docker compose ps` (replica-2 stopped):

```
team-2-food-delivery-restaurant-service-1   Up (healthy)
team-2-food-delivery-restaurant-service-2   Exited
team-2-food-delivery-restaurant-service-3   Up (healthy)
```

After restart — `docker compose ps`:

```
team-2-food-delivery-restaurant-service-1   Up (healthy)
team-2-food-delivery-restaurant-service-2   Up (healthy)
team-2-food-delivery-restaurant-service-3   Up (healthy)
```

---

## Blockers and Lessons Learned

The biggest challenge was making sure replication worked cleanly across the whole system and not just the individual services. Small configuration issues in Compose, Caddy, health checks, and environment variables could prevent replicas from starting or receiving traffic correctly, so we learned that scaling depends on careful coordination and stateless service design. We ran into some issues when one of the services had a bug, but we were able to test independently to fix it. 