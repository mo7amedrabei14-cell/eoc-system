-- 2026-09-22 — Add staff view permission for human power log
-- New permission: mission.staff.view
-- Assign to READ_ONLY_MISSIONS role

BEGIN;

-- Add new permission
INSERT INTO public.permissions (permission_id, permission_code, description, created_at)
VALUES (27, 'mission.staff.view', 'View mission staff/human power log', (now() AT TIME ZONE 'Africa/Cairo'))
ON CONFLICT (permission_id) DO NOTHING;

-- Grant mission.staff.view permission to READ_ONLY_MISSIONS role (role_id = 6)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT 6, 27, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
WHERE r.role_name = 'READ_ONLY_MISSIONS'
ON CONFLICT DO NOTHING;

COMMIT;