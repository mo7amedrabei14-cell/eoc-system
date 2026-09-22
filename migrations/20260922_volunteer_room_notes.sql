-- 2026-09-22 — Volunteer Room Notes section (ملاحظات غرفة التطوع)
-- Storage for the per-mission volunteer-room notes rows + reviewer name.
-- Editable only by Youth & Volunteers (READ_ONLY_MISSIONS) and OWNER — enforced in
-- backend via the existing permission system (new scoped permission: mission.volunteer_room_notes).
-- The new reviewed status (مكتملة (تمت المراجعة من إدارة الشباب)) needs NO schema change:
-- missions.status is VARCHAR(50) with no CHECK constraint (verified in Data Base.sql dump).
--
-- Idempotent: safe to run multiple times (IF NOT EXISTS / NOT EXISTS guards).
-- ملاحظة: لا نثبّت permission_id يدوياً (العمود GENERATED ALWAYS AS IDENTITY) —
-- نُدرج بالكود فقط ثم نمنح الصلاحية بالبحث عن الـ id من الكود نفسه.

BEGIN;

-- 1) Rows of the Volunteer Room Notes section (ordered list per mission)
CREATE TABLE IF NOT EXISTS public.mission_volunteer_room_notes (
    note_id     BIGSERIAL PRIMARY KEY,
    mission_id  INTEGER NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
    note_date   DATE,
    membership_number VARCHAR(100),
    member_name VARCHAR(255),
    note_text   TEXT,
    row_order   INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

CREATE INDEX IF NOT EXISTS idx_mission_vrn_mission
    ON public.mission_volunteer_room_notes (mission_id, row_order, note_id);

-- 2) Reviewer name (اسم مراجع الاستمارة) — always the final element of the section
ALTER TABLE public.missions
    ADD COLUMN IF NOT EXISTS volunteer_room_reviewer_name VARCHAR(255);

-- 3) Scoped permission for editing ONLY this section (not the rest of the mission form)
INSERT INTO public.permissions (permission_code, description, created_at)
SELECT 'mission.volunteer_room_notes', 'Edit Volunteer Room Notes section (youth & owner only)', (now() AT TIME ZONE 'Africa/Cairo')
WHERE NOT EXISTS (
    SELECT 1 FROM public.permissions WHERE permission_code = 'mission.volunteer_room_notes'
);

-- Grant to READ_ONLY_MISSIONS (role 6) — same convention as perms 26/27/28
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT 6, p.permission_id, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.permissions p
WHERE p.permission_code = 'mission.volunteer_room_notes'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = 6 AND rp.permission_id = p.permission_id
  );

-- Grant to OWNER
INSERT INTO public.role_permissions (role_id, permission_id, created_at)
SELECT r.role_id, p.permission_id, (now() AT TIME ZONE 'Africa/Cairo')
FROM public.roles r, public.permissions p
WHERE r.role_name = 'OWNER'
  AND p.permission_code = 'mission.volunteer_room_notes'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
  );

COMMIT;
