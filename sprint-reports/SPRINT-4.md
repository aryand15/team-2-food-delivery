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
| [Name]      | | |

---

## Starting the System with Replicas

```bash
docker compose up --build --scale order-service=3 --scale driver-service=3 --scale restaurant-service=3
```

After startup:

```
[Paste docker compose ps output here showing all replicas as (healthy)]
```

---

## What Is Working

- [ ] At least [N] services replicated via `--scale`
- [ ] Load balancer distributes traffic across replicas (visible in logs)
- [ ] Services are stateless — multiple instances run without conflicts
- [ ] `docker compose ps` shows all replicas as `(healthy)`
- [ ] System is fully complete for team size

---

## What Is Not Working / Cut

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
