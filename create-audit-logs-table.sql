-- ============================================================
-- CREATE admin_audit_logs TABLE
-- ============================================================
-- Run this script on your server PostgreSQL database once.
-- This enables the Admin Panel Activity Monitor (Audit Log) feature.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER,
    username     VARCHAR(100) NOT NULL DEFAULT 'Unknown',
    role         VARCHAR(100),
    action       VARCHAR(20) NOT NULL,       -- CREATE | UPDATE | DELETE
    module       VARCHAR(100),               -- e.g. "Farm Activity", "Admin Users"
    ip_address   VARCHAR(60),                -- IPv4 or IPv6
    request_url  TEXT,                       -- Full request path
    details      TEXT,                       -- JSON body (sanitized - no passwords)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at   ON public.admin_audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username     ON public.admin_audit_logs (username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action       ON public.admin_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module       ON public.admin_audit_logs (module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip           ON public.admin_audit_logs (ip_address);

-- Confirm creation
SELECT
    table_name,
    (SELECT COUNT(*) FROM public.admin_audit_logs) AS existing_rows
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'admin_audit_logs';
