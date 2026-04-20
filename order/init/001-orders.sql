CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  restaurant_id TEXT NOT NULL,
  customer_id TEXT,
  items JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  dispatch_attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);