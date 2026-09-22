-- 2026-09-21 — Add volunteer observation notes permission
-- New permission: mission.volunteer_notes
-- Assign to READ_ONLY_MISSIONS and OWNER roles

BEGIN;

-- Add new permission
INSERT INTO public.permissions (permission_id, permission_code, description, created_at)
VALUES (26, 'mission.volunteer_notes', 'Add/edit volunteer observation notes', (now() AT TIME ZONE 'Africa/Cairo'))
ON CONFLICT (permission_id) DO NOTHING;

-- Grant mission.volunteer_notes permission to READ_ONLY_MISSIONS role (role_id = 6)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT 6, 26, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
WHERE r.role_name = 'READ_ONLY_MISSIONS'
ON CONFLICT DO NOTHING;

-- Grant mission.volunteer_notes permission to OWNER role (role_id = 5)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT 5, 26, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
WHERE r.role_name = 'OWNER'
ON CONFLICT DO NOTHING;

COMMIT;