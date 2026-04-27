# Sprint 2 Plan — [Team Name]

**Sprint:** 2 — Async Pipelines and Caching  
**Dates:** 04.14 → 04.21  
**Written:** 04.14 in class

---

## Goal
2
All 5 workers will have a working health endpoint which includes the current queue depth, the dead letter queue depth, and the timestamp of the last successfully processed job. The restaurant service will expose a /menu endpoint that uses a Redis cache to retrieve the menu from the cache on subsequent requests. For the idempontency requirement, the order service will expose a POST /orders endpoint that doesn't allow duplicate orders. For the async pipeline, the order service pushes an order to a Redis queue, which the order dispatch worker will pick up. We will also have k6 tests working. 

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| Gianna      | `/notification-worker` |
| Jada      | `/preparation-tracker-worker` |
| Phoebe      | `/delivery-tracker-worker` |
| Nivaan      | `/surge-pricing-worker` |
| Ashley      | `/order-dispatch-worker` |
| Aryan      | `/order` |
| Ayaan      | `/restaurant` |
| Eva      | `/k6` |


---

## Tasks

### Gianna

- Implement a working health endpoint for notification worker

### Jada

- Implement a working health endpoint for preparation tracker worker

### Phoebe

- Bare minimum structure for delivery tracker service
- Implement a working health endpoint for delivery tracker worker

### Nivaan

- Bare minimum structure for rating and review service
- Implement a working health endpoint for surge tracker worker

### Ashley

- Implement a working health endpoint for order dispatch worker
- Pick up an order from the redis queue and do something to confirm that it received the order

### Aryan

- Implement idempotency for the POST /orders endpoint such that duplicate orders are not allowed
- Push order info to a Redis queue

### Ayaan

- Expose a /menu endpoint that uses a Redis cache

### Eva

- Write k6 tests for caching comparison and async pipeline throughput


## Risks

We have to be careful about naming the Redis queues and pub/sub correctly and such that a worker doesn't pick up jobs from the wrong queue.

---

## Definition of Done

A TA can trigger an action, watch the queue flow in Docker Compose logs, hit the worker's `/health` to see queue depth and last-job-at, and review k6 results showing the caching improvement.
