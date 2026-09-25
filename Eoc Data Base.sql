SELECT m.mission_id, s.role_name, s.staff_name
FROM mission_eoc_staff s
JOIN missions m ON m.mission_id = s.mission_id
ORDER BY m.mission_id DESC
LIMIT 20;
