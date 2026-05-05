# Sprint 4 Report — Team 2

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** [date, before 05.05 class]

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
| Phoebe      | | |
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

- [ ] At least 3 services replicated via `--scale`
- [ ] Load balancer distributes traffic across replicas (visible in logs)
- [ ] Services are stateless — multiple instances run without conflicts
- [ ] `docker compose ps` shows all replicas as `(healthy)`
- [ ] System is fully complete for team size

---

## What Is Not Working / Cut

There were no Sprint 4 features intentionally cut from scope. Sprint 4 focused on replication, load balancing, resilience under replica failure, and final system polish rather than adding new core functionality. Any remaining issues were limited to smaller polish or integration concerns.
---

## k6 Results

### Test 1: Scaling Comparison (`k6/sprint-4-scale.js`)

| Metric | 1 replica | 3 replicas | Change |
| ------ | --------- | ---------- | ------ |
| p50    | | | |
| p95    | | | |
| p99    | | | |
| RPS    | | | |

[Explain the improvement. Which replica count started to show diminishing returns?]

### Test 2: Replica Failure (`k6/sprint-4-replica.js`)

Timeline:

| Time | Event |
| ---- | ----- |
| 0s   | k6 started, 3 replicas running |
| [t]s | Killed replica: `docker stop [container-id]` |
| [t]s | Surviving replicas absorbed traffic |
| [t]s | Replica restarted: `docker compose up -d` |
| [t]s | Traffic redistributed, back to normal |

```
[Paste k6 output showing before / during / after the failure — annotate with timestamps]
```

During failure — `docker compose ps`:

```
[Paste output showing stopped/unhealthy replica alongside healthy survivors]
```

After restart — `docker compose ps`:

```
[Paste output showing all replicas back to (healthy)]
```

---

## Blockers and Lessons Learned

The biggest challenge was making sure replication worked cleanly across the whole system and not just the individual services. Small configuration issues in Compose, Caddy, health checks, and environment variables could prevent replicas from starting or receiving traffic correctly, so we learned that scaling depends on careful coordination and stateless service design. We ran into some issues when one of the services had a bug, but we were able to test independently to fix it. 