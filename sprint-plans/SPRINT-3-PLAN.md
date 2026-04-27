# Sprint 3 Plan — [Team 2]

**Sprint:** 3 — Reliability and Poison Pills  
**Dates:** 04.21 → 04.28  
**Written:** 04.21 in class

---

## Goal

[What reliability improvements and poison pill handling will your team add? Which queues get DLQ handling?]

We will improve system reliability by adding DLQ handling to every worker pipeline. We will also finish any remaining service and worker integration needed for the full flow, and make sure worker health endpoints report DLQ depth while staying healthy under poison pill traffic.

The queues that will get DLQ handling are:

* `orders:queue` → for the Order Dispatch Worker
* `notifications:queue` →  for the Notification Worker
* `pricing:queue` →  for the Surge Pricing Worker
* `preparation:queue` →  for the Preparation Tracker Worker

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

### [Gianna]

- [ ] Implement poison pill endpoint for notification worker

### [Jada]

- [ ] Implement poison pill endpoint for preparation tracker worker

### [Phoebe]

- [ ] Implement poison pill endpoint for delivery tracker worker

### [Nivaan]

- [ ] Implement poison pill endpoint for surge pricing worker 
- [ ] Implement database/functionality to service

### [Ashley]

- [ ] Implement poison pill endpoint for order dispatch worker

### [Aryan]

- [ ] Implement database and functionality to the services

### [Ayaan]

- [ ] Implement database and functionality to the services

### [Eva]

- [ ] Implement poison pill k6 test
- [ ] documentation in sprint 3 report

---

## Risks

We have to make sure miscommunication between workers/services and queues are handled gracefully. Also, incorrect data could get into the wrong DLQ or no data going in at all. 

---

## Definition of Done

After injecting poison pills, the worker's `/health` shows non-zero `dlq_depth` while status remains `healthy`. Good messages keep flowing. k6 results show throughput does not collapse.
