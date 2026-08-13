-- ============================================================
-- MIGRATION: Add bluetooth_entry column to driver table
-- Run this script on your PostgreSQL database
-- to enable Bluetooth (Weight Machine) access control
-- per user in the Broiler module.
-- ============================================================

-- Step 1: Add the bluetooth_entry column (safe - skips if already exists)
ALTER TABLE public.driver
    ADD COLUMN IF NOT EXISTS bluetooth_entry BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2: Confirm the column was added
SELECT
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'driver'
  AND column_name  = 'bluetooth_entry';
