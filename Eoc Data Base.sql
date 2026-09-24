UPDATE missions SET
  mission_location = REPLACE(REPLACE(mission_location, 'مرسي مطروح', 'مطروح'), 'بورسعيد', 'بور سعيد'),
  mission_name     = REPLACE(REPLACE(mission_name,     'مرسي مطروح', 'مطروح'), 'بورسعيد', 'بور سعيد')
WHERE mission_location LIKE '%مرسي مطروح%' OR mission_name LIKE '%مرسي مطروح%'
   OR mission_location LIKE '%بورسعيد%'  OR mission_name LIKE '%بورسعيد%';
