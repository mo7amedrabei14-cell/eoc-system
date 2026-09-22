-- 2026-09-23 — Add youth review permission for READ_ONLY_MISSIONS and OWNER roles
-- New permission: mission.youth_review

BEGIN;

-- Add new permission
INSERT INTO public.permissions (permission_id, permission_code, description, created_at)
VALUES (28, 'mission.youth_review', 'Perform youth review on completed missions', (now() AT TIME ZONE 'Africa/Cairo'))
ON CONFLICT (permission_id) DO NOTHING;

-- Grant mission.youth_review permission to READ_ONLY_MISSIONS role (role_id = 6)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT 6, 28, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
WHERE r.role_name = 'READ_ONLY_MISSIONS'
ON CONFLICT DO NOTHING;

-- Grant mission.youth_review permission to OWNER role (role_id = 5)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT 5, 28, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
WHERE r.role_name = 'OWNER'
ON CONFLICT DO NOTHING;

COMMIT;