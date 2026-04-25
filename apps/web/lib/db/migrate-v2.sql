-- Migration v2: Add projects_count and storage_bytes to usage_counters
-- Run this against your Neon database if the table already exists from schema.sql v1

ALTER TABLE usage_counters ADD COLUMN IF NOT EXISTS projects_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_counters ADD COLUMN IF NOT EXISTS storage_bytes BIGINT NOT NULL DEFAULT 0;
