-- 2026-09-23 — Add youth review permission for READ_ONLY_MISSIONS and OWNER roles
-- New permission: mission.youth_review
-- v2: grants resolved by permission_code lookup (not hard-coded ID) so the grant
--     cannot be missed when the online identity sequence assigns different IDs.

BEGIN;

-- Add new permission (idempotent by code)
INSERT INTO public.permissions (permission_code, description, created_at)
SELECT 'mission.youth_review', 'Perform youth review on completed missions', (now() AT TIME ZONE 'Africa/Cairo')
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE permission_code = 'mission.youth_review');

-- Grant mission.youth_review to READ_ONLY_MISSIONS (role 6)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT r.role_id, p.permission_id, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.role_name = 'READ_ONLY_MISSIONS'
  AND p.permission_code = 'mission.youth_review'
ON CONFLICT DO NOTHING;

-- Grant mission.youth_review to OWNER (role 5, any naming variant)
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT r.role_id, p.permission_id, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.role_name IN ('OWNER', 'المالك')
  AND p.permission_code = 'mission.youth_review'
ON CONFLICT DO NOTHING;

COMMIT;
