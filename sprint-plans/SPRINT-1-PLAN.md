# Sprint 1 Plan — Team 2

**Sprint:** 1 — Foundation  
**Dates:** 04.07 → 04.14  
**Written:** 04.07 in class

---

## Goal

The main goal of Sprint 1 is to have a working system where we have at least one service to service HTTP call and each service connects to its own Postgres database where it exposes at least one working endpoint. We would like atleast 1-2 services and synchronous call between them running in Docker Compose with health endpoints. 

---

## Ownership


| Team Member | Services / Components Owned                            |
| ----------- | ------------------------------------------------------ |
| Nivan     | [e.g. `driver-service/`, `driver-db/`] |
| Aryan    | [e.g. `order-service/`, `order-db/`]       |
| Ayaan    | [e.g. `restaurant-service/`, `restaurant-db/`]         |
| Eva    | [e.g. `redis`, `caddy`]         |
| Jada    | [e.g. `preparation-tracker`, `delivery-tracker/`]         |
| Ashley    | [e.g. `order-dispatch`]         |
| Gianna    | [e.g. `notification-worker`]         |

Each person must have meaningful commits in the paths they claim. Ownership is verified by:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## Tasks

### Nivan & Gianna

- [ ] Set up `driver-service/` with Express + Postgres connection
- [ ] Implement one working endpoint

### Ayaan & Jada

- [ ] Set up `restaurant-service/` with Express + Postgres connection
- [ ] Implement one working endpoint
- [ ] Write `compose.yml` connecting services


### Aryan & Ashley

- [ ] Set up `order-service/` with Express + Postgres connection
- [ ] Implement one working endpoint


### Eva 

- [ ] Create a Redis container that is running and at least one service connects to it on startup

---

## Risks

We could end up with problems pushing to the branch at the same time, dealing with debugging, taking some time to set up the services, and dealing with dependency issues. We will ask for help from the professor or the TA if it takes longer than expected and clearly communicate with our teammates.

---

## Definition of Done

A TA can clone this repo, check out `sprint-1`, run `docker compose up`, and:

- `docker compose ps` shows every service as `(healthy)`
- `GET /health` on each service returns `200` with DB and Redis status
- The synchronous service-to-service call works end-to-end
- k6 baseline results are included in `SPRINT-1.md`
