# Team 2 — Food Delivery Coordination

**Course:** COMPSCI 426  
**Team:** Eva Choudhury, Gianna Leidich, Jada Tu, Ashley Kang, Nivaan Gupta, Aryan Deshpande, Ayaan Sattar, Phoebe Lo  
**System:** Food Delivery  
**Repository:** https://github.com/aryand15/team-2-food-delivery

---

## Team and Service Ownership

| Team Member | Services / Components Owned              |
| ----------- | ---------------------------------------- |
| Nivan       | `driver-service/`, `driver-db/`          |
| Aryan       | `order-service/`, `order-db/`            |
| Ayaan       | `restaurant-service/`                    |
| Eva         | `compose.yml`, `redis`                   |
| Jada        | `restaurant-service/`, `restaurant-db/`  |
| Ashley      | `order-service/`                         |
| Gianna      | `driver-service/`                        |
| Phoebe      | `k6/`, `sprint-reports/`                 |

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
order-service       http://localhost:3001
driver-service      http://localhost:3002
restaurant-service  http://localhost:3003
holmes              (no port — access via exec)
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

## Sprint History

| Sprint | Tag        | Plan                                              | Report                                    |
| ------ | ---------- | ------------------------------------------------- | ----------------------------------------- |
| 1      | `sprint-1` | [SPRINT-1-PLAN.md](sprint-plans/SPRINT-1-PLAN.md) | [SPRINT-1.md](sprint-reports/SPRINT-1.md) |
| 2      | `sprint-2` | [SPRINT-2-PLAN.md](sprint-plans/SPRINT-2-PLAN.md) | [SPRINT-2.md](sprint-reports/SPRINT-2.md) |
| 3      | `sprint-3` | [SPRINT-3-PLAN.md](sprint-plans/SPRINT-3-PLAN.md) | [SPRINT-3.md](sprint-reports/SPRINT-3.md) |
| 4      | `sprint-4` | [SPRINT-4-PLAN.md](sprint-plans/SPRINT-4-PLAN.md) | [SPRINT-4.md](sprint-reports/SPRINT-4.md) |
