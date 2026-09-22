-- 2026-09-20 — Add READ_ONLY_MISSIONS role
-- Standalone role with ONLY read permissions for missions
-- No role_inheritance entries (must not inherit from Operation which has mutation permissions)

BEGIN;

-- Insert the new role (role_id will be auto-assigned as 6 via sequence)
INSERT INTO public.roles (role_name, description, created_at)
VALUES ('READ_ONLY_MISSIONS', 'Read Only - Missions', (now() AT TIME ZONE 'Africa/Cairo'))
ON CONFLICT (role_name) DO NOTHING;

-- Grant mission.view permission (permission_id = 1)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT r.role_id, 1, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
WHERE r.role_name = 'READ_ONLY_MISSIONS'
ON CONFLICT DO NOTHING;

-- Grant mission.history.view permission (permission_id = 16)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT r.role_id, 16, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
WHERE r.role_name = 'READ_ONLY_MISSIONS'
ON CONFLICT DO NOTHING;

-- NO role_inheritance entries - this role is standalone and must NOT inherit from Operation

COMMIT;