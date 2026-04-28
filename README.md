# Team 2 — Food Delivery Coordination

**Course:** COMPSCI 426  
**Team:** Eva Choudhury, Gianna Leidich, Jada Tu, Ashley Kang, Nivaan Gupta, Aryan Deshpande, Ayaan Sattar, Phoebe Lo  
**System:** Food Delivery  
**Repository:** https://github.com/aryand15/team-2-food-delivery

---

## Team and Service Ownership

| Team Member | Services / Components Owned                             |
| ----------- | ------------------------------------------------------- |
| Nivaan      | `driver-service/`, `driver-db/`, `surge-pricing-worker/`|
| Aryan       | `order-service/`, `order-db/`                           |
| Ayaan       | `restaurant-service/`, `restaurant-db`                  |
| Eva         | `compose.yml`, `redis`, `k6/`                           |
| Jada        | `preparation-tracker-worker/`                           |
| Ashley      | `order-dispatch-worker/`                                |
| Gianna      | `notification-worker/`                                  |
| Phoebe      | `delivery-tracker-worker/`                              |

> Ownership is verified by `git log --author`. Each person must have meaningful commits in the directories they claim.

---

## How to Start the System

```bash
# Start everything (builds images on first run)
docker compose up --build

# Start with service replicas (Sprint 4)
docker compose up --scale your-service=3

# Verify all services are healthy
docker compose ps

# Stream logs
docker compose logs -f

# Open a shell in the holmes investigation container
docker compose exec holmes bash
```

### Base URLs (development)

```
order-service         http://localhost:3001
driver-service        http://localhost:3002
restaurant-service    http://localhost:3003
rating-service        http://localhost:3004
surge-pricing-worker      http://localhost:3005
delivery-tracker-worker   http://localhost:3006
holmes                    (no port — access via exec)
```

> From inside holmes, services are reachable by name:
> `curl http://order-service:3001/health`
>
> See [holmes/README.md](holmes/README.md) for a full tool reference.

---

## System Overview

Three microservices handle different parts of a food delivery platform. `order-service` manages order coordination and makes a live synchronous call to `driver-service` to fetch available drivers. `driver-service` manages driver data. `restaurant-service` manages restaurant listings. Each service has its own Postgres database and connects to a shared Redis instance for caching. All services communicate over an internal Docker network (`team-net`) and are wired together via `compose.yml`.

---

## API Reference

<!--
  Document every endpoint for every service.
  Follow the format described in the project documentation: compact code block notation, then an example curl and an example response. Add a level-2 heading per service, level-3 per endpoint.
-->

---

### order-service

#### GET /health

```
GET /health

  Returns the health status of this service and its dependencies.

  Responses:
    200  Service and all dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:3001/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "order-service",
  "timestamp": "2026-04-15T00:00:00.000Z",
  "uptime_seconds": 120,
  "checks": {
    "database": { "status": "healthy", "latency_ms": 3 },
    "redis": { "status": "healthy", "latency_ms": 1 }
  }
}
```

#### GET /get-drivers

```
GET /get-drivers

  Fetches the list of available drivers from driver-service.

  Responses:
    200  Driver list returned successfully
```

**Example request:**

```bash
curl http://localhost:3001/get-drivers
```

**Example response (200):**

```json
[
  { "id": 1, "name": "John Doe", "status": "available" },
  { "id": 2, "name": "Jane Smith", "status": "busy" }
]
```

#### POST /orders

```
POST /orders

  Creates a new order if the idempotency key has not been used before.
  If the same clientOrderId is submitted again, the existing order is returned.

  Request body:
    clientOrderId  string   required
    restaurantId   string   required
    items          array    required

  Each item object must contain:
    menuItemId     integer  required
    quantity       integer  required, must be > 0

  Responses:
    201  Order accepted and queued
    200  Duplicate order, existing order returned
    400  Invalid request body
    500  Internal server error
```

**Example request:**

```bash
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{
    "clientOrderId": "order-123",
    "restaurantId": "1",
    "items": [
      { "menuItemId": 101, "quantity": 2 },
      { "menuItemId": 103, "quantity": 1 }
    ]
  }'
```

**Example response (201):**

```json
{
  "message": "Order accepted",
  "order": {
    "id": "0f2c6d92-2fa4-4a91-b87f-cf6d0d6a9d50",
    "idempotency_key": "order-123",
    "restaurant_id": "1",
    "customer_id": null,
    "items": [
      { "menuItemId": 101, "quantity": 2 },
      { "menuItemId": 103, "quantity": 1 }
    ],
    "status": "queued",
    "dispatch_attempt_count": 0,
    "created_at": "2026-04-28T00:00:00.000Z",
    "updated_at": "2026-04-28T00:00:00.000Z"
  }
}
```

#### GET /orders/:id

```
GET /orders/:id

  Returns the current status and metadata for a single order.

  Path parameters:
    id  string  required

  Responses:
    200  Order found
    404  Order not found
    500  Internal server error
```

**Example request:**

```bash
curl http://localhost:3001/orders/0f2c6d92-2fa4-4a91-b87f-cf6d0d6a9d50
```

**Example response (200):**

```json
{
  "orderId": "0f2c6d92-2fa4-4a91-b87f-cf6d0d6a9d50",
  "clientOrderId": "order-123",
  "restaurantId": "1",
  "customerId": null,
  "status": "queued",
  "dispatchAttemptCount": 0,
  "createdAt": "2026-04-28T00:00:00.000Z",
  "updatedAt": "2026-04-28T00:00:00.000Z"
}
```

---

### driver-service

#### GET /health

```
GET /health

  Returns the health status of this service and its dependencies.

  Responses:
    200  Service and all dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:3002/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "driver-service",
  "timestamp": "2026-04-15T00:00:00.000Z",
  "uptime_seconds": 120,
  "checks": {
    "database": { "status": "healthy", "latency_ms": 3 },
    "redis": { "status": "healthy", "latency_ms": 1 }
  }
}
```

#### GET /drivers

```
GET /drivers

  Returns the list of drivers.

  Responses:
    200  Driver list returned successfully
```

**Example request:**

```bash
curl http://localhost:3002/drivers
```

**Example response (200):**

```json
[
  { "id": 1, "name": "John Doe", "status": "available" },
  { "id": 2, "name": "Jane Smith", "status": "busy" }
]
```

---

### restaurant-service

#### GET /health

```
GET /health

  Returns the health status of this service and its dependencies.

  Responses:
    200  Service and all dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:3003/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "restaurant-service",
  "timestamp": "2026-04-15T00:00:00.000Z",
  "uptime_seconds": 120,
  "checks": {
    "database": { "status": "healthy", "latency_ms": 3 },
    "redis": { "status": "healthy", "latency_ms": 1 }
  }
}
```

#### GET /restaurants

```
GET /restaurants

  Returns the list of restaurants.

  Responses:
    200  Restaurant list returned successfully
```

**Example request:**

```bash
curl http://localhost:3003/restaurants
```

**Example response (200):**

```json
[
  { "id": 1, "name": "Sample Restaurant", "cuisine": "Test Cuisine", "is_open": true }
]
```

---

### rating-service

#### GET /health

```
GET /health

  Returns the health status of this service and its dependencies.

  Responses:
    200  Service and all dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:3004/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "rating-service",
  "timestamp": "2026-04-18T00:00:00.000Z",
  "uptime_seconds": 120,
  "checks": {
    "database": { "status": "healthy", "latency_ms": 3 },
    "redis": { "status": "healthy", "latency_ms": 1 }
  }
}
```

#### POST /ratings

```
POST /ratings

  Accepts a post-delivery rating. Validates the order via a synchronous call to
  order-service, stores the rating in rating-db, and publishes a
  "rating:submitted" event on Redis pub/sub.

  Request body (application/json):
    order_id       string   required
    restaurant_id  integer  required
    customer_id    string   required
    rating         integer  required, 1–5
    review         string   optional

  Responses:
    201  Rating stored and event published
    400  Invalid payload or order not completed
    503  order-service unreachable
```

**Example request:**

```bash
curl -X POST http://localhost:3004/ratings \
  -H "Content-Type: application/json" \
  -d '{"order_id":"ord-123","restaurant_id":1,"customer_id":"cust-7","rating":5,"review":"Great food"}'
```

**Example response (201):**

```json
{
  "id": 1,
  "order_id": "ord-123",
  "restaurant_id": 1,
  "customer_id": "cust-7",
  "rating": 5,
  "review": "Great food",
  "created_at": "2026-04-18T00:00:00.000Z"
}
```

#### GET /rankings

```
GET /rankings

  Returns restaurants ranked by average rating, aggregated across all stored
  ratings.

  Responses:
    200  Ranking list returned successfully
```

**Example request:**

```bash
curl http://localhost:3004/rankings
```

**Example response (200):**

```json
[
  { "restaurant_id": 1, "average_rating": "4.75", "total_ratings": "4" },
  { "restaurant_id": 2, "average_rating": "3.50", "total_ratings": "2" }
]
```

---

### surge-pricing-worker

Background worker that consumes order-volume events from a Redis list
(`orders:volume`) and writes surge periods to `pricing-db` when a restaurant's
order count crosses `SURGE_THRESHOLD`. Activating a surge publishes a
`surge:active` event on Redis pub/sub. Idempotent — duplicate `event_id`s are
skipped. Malformed events go to the dead-letter queue (`orders:volume:dlq`).

Push a test event (from holmes or your host):

```bash
redis-cli -h redis LPUSH orders:volume \
  '{"event_id":"evt-1","restaurant_id":1,"order_count":12}'
```

#### GET /health

```
GET /health

  Returns the worker's health plus live queue stats.

  Responses:
    200  Worker, DB, and Redis all healthy
    503  DB or Redis unreachable

  Body fields:
    queue              the list being consumed
    queue_depth        current LLEN of the work queue
    dlq_depth          current LLEN of the dead-letter queue
    last_processed_at  ISO timestamp of the most recently completed job
                       (null until the first event is handled)
```

**Example request:**

```bash
curl http://localhost:3005/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "surge-pricing-worker",
  "timestamp": "2026-04-20T00:00:00.000Z",
  "uptime_seconds": 120,
  "queue": "orders:volume",
  "queue_depth": 0,
  "dlq_depth": 0,
  "last_processed_at": "2026-04-20T00:00:00.000Z",
  "checks": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" }
  }
}
```

---

### delivery-tracker-worker

Background worker that consumes delivery jobs from a Redis list (`deliveries:queue`). Logs structured output for each job received. Malformed messages go to the dead-letter queue (`deliveries:queue:dlq`).

Push a test job (from holmes or your host):

```bash
redis-cli -h redis LPUSH deliveries:queue '{"id":"job-1"}'
```

#### GET /health

```
GET /health

  Returns the worker's health plus live queue stats.

  Responses:
    200  Worker and Redis healthy
    503  Redis unreachable

  Body fields:
    queue          the list being consumed
    queue_depth    current depth of the work queue
    dlq_depth      current depth of the dead-letter queue
    last_job_at    ISO timestamp of the most recently completed job
                   (null until the first job is handled)
    jobs_processed total count of jobs processed since startup
```

**Example request:**

```bash
curl http://localhost:3006/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "delivery-tracker-worker",
  "timestamp": "2026-04-20T00:00:00.000Z",
  "uptime_seconds": 120,
  "queue": "deliveries:queue",
  "queue_depth": 0,
  "dlq_depth": 0,
  "last_job_at": null,
  "jobs_processed": 0,
  "checks": {
    "redis": { "status": "healthy", "latency_ms": 1 }
  }
}
```

---

## Sprint History

| Sprint | Tag        | Plan                                              | Report                                    |
| ------ | ---------- | ------------------------------------------------- | ----------------------------------------- |
| 1      | `sprint-1` | [SPRINT-1-PLAN.md](sprint-plans/SPRINT-1-PLAN.md) | [SPRINT-1.md](sprint-reports/SPRINT-1.md) |
| 2      | `sprint-2` | [SPRINT-2-PLAN.md](sprint-plans/SPRINT-2-PLAN.md) | [SPRINT-2.md](sprint-reports/SPRINT-2.md) |
| 3      | `sprint-3` | [SPRINT-3-PLAN.md](sprint-plans/SPRINT-3-PLAN.md) | [SPRINT-3.md](sprint-reports/SPRINT-3.md) |
| 4      | `sprint-4` | [SPRINT-4-PLAN.md](sprint-plans/SPRINT-4-PLAN.md) | [SPRINT-4.md](sprint-reports/SPRINT-4.md) |
