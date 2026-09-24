BEGIN;

-- إغلاق كل شريحة مفتوحة في مهمة مكتملة:
-- لو الإغلاق بعد الانضمام ⇒ end = لحظة الإغلاق (ساعات حقيقية)
-- لو الانضمام بعد الإغلاق (حالاتك دي) ⇒ end = الانضمام نفسه (مدة صفر — صحيح منطقيًا)
UPDATE mission_participant_sessions s
SET end_dt = CASE
        WHEN m.closed_at IS NOT NULL AND m.closed_at > s.start_dt THEN m.closed_at
        ELSE s.start_dt
     END,
    check_out_time = CASE
        WHEN m.closed_at IS NOT NULL AND m.closed_at > s.start_dt THEN m.closed_at::time
        ELSE s.start_dt::time
     END
FROM missions m
WHERE m.mission_id = s.mission_id
  AND m.status IN ('Completed','مكتملة',
                   'Completed (Reviewed by Youth Administration)',
                   'مكتملة (تمت المراجعة من إدارة الشباب)')
  AND s.end_dt IS NULL AND s.start_dt IS NOT NULL;

-- توحيد حالة كل من في مهمة مكتملة ⇒ «تم انتهاء مهمتة»
UPDATE mission_participants p
SET return_status = 'تم انتهاء مهمتة'
FROM missions m
WHERE m.mission_id = p.mission_id
  AND m.status IN ('Completed','مكتملة',
                   'Completed (Reviewed by Youth Administration)',
                   'مكتملة (تمت المراجعة من إدارة الشباب)');

COMMIT;
