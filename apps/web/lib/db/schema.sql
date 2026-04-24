-- CastWeave App Database Schema (Neon Postgres)
-- Run this once against your Neon database to bootstrap the schema.

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT UNIQUE NOT NULL,
  name              TEXT,
  avatar_url        TEXT,
  auth_provider     TEXT NOT NULL DEFAULT 'google',
  plan              TEXT NOT NULL DEFAULT 'free',
  dodo_customer_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dodo_subscription_id  TEXT UNIQUE,
  dodo_product_id       TEXT,
  plan                  TEXT NOT NULL DEFAULT 'free',
  status                TEXT NOT NULL DEFAULT 'active',
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_dodo ON subscriptions(dodo_subscription_id);

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start   TIMESTAMPTZ NOT NULL,
  period_end     TIMESTAMPTZ NOT NULL,
  imports        INTEGER NOT NULL DEFAULT 0,
  media_seconds  INTEGER NOT NULL DEFAULT 0,
  line_gens      INTEGER NOT NULL DEFAULT 0,
  preview_gens   INTEGER NOT NULL DEFAULT 0,
  voice_uploads  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period_start)
);
