-- ============================================================
-- CREATE user_login_logs TABLE
-- Run this script on your server's PostgreSQL database
-- to enable the Broiler Dashboard login tracking feature.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_login_logs (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(100) NOT NULL,
    fullname    VARCHAR(200),
    role        VARCHAR(100),
    category    VARCHAR(100),
    login_time  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast date-range queries used by the dashboard
CREATE INDEX IF NOT EXISTS idx_user_login_logs_login_time
    ON public.user_login_logs (login_time);

CREATE INDEX IF NOT EXISTS idx_user_login_logs_category
    ON public.user_login_logs (category);

-- Confirm creation
SELECT
    table_schema,
    table_name,
    (SELECT COUNT(*) FROM public.user_login_logs) AS existing_rows
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'user_login_logs';
