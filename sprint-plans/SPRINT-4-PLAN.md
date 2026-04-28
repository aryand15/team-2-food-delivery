# Sprint 4 Plan — Team 2

**Sprint:** 4 — Replication, Scaling, and Polish  
**Dates:** 04.28 → 05.07  
**Written:** 04.28 in class

---

## Goal

We will replicate our three core services, restaurant service, order service, and driver service. The exact command should be `docker compose up --build --scale order-service=3 --scale restaurant-service=3 --scale driver-service=3`. We need to make sure our system all workers together properly and to completely test the workflow from start to finish once we implement Caddy. We will have to throroughly test our system to ensure we don't run into any issues especially with using Caddy for the first time in our project.

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| Eva      | `/k6` |
| Aryan      | `/order` |
| Gianna      | `/notification-worker` |
| Jada      | `/preperation-tracker-worker`, `sprint-reports` |
| Ashley      | `/order-dispatch-worker` |
| Nivaan      | `/driver` |
| Ayaan      | `/caddy`, `/restaurant` |
| Phoebe      | `/k6`, `README.md`|


---

## Tasks

### Eva

- Write the k6 test for scaling (sprint-4-scale.js)

### Aryan

- Make sure order service is stateless, create replica of it, and ensure it works properly with scaling

### Ayaan

- Configure Caddy load balancer
- Make sure restaurant service is stateless, create replica of it, and ensure it works properly with scaling

### Nivaan

- Create replica for driver service works and ensure it works properly with scaling

### Phoebe

- Create detailed final README.md with all necessary components
- Write the k6 test for replica (sprint-4-replica.js)


### Jada

- Finalize functionality for services + workers
- Complete the Sprint 4 report

### Ashley & Gianna

- Finalize functionality for services + workers
- Any polishing & debugging necessary to complete our system

---

## Risks

We need to make sure Caddy is up and running early during this sprint since the replicas and the k6 tests depend on that. We also need to make sure our services are stateless or we will run into a lot of issues. Re-configuring everything to use caddy may cause bugs which we need to address early.

---

## Definition of Done

`docker compose up --scale [service]=3` starts successfully. `docker compose ps` shows all replicas as `(healthy)`. k6 scaling comparison shows measurable improvement. Replica failure test shows no dropped requests.
