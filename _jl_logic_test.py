"""Logic test for the JOIN/LEAVE hour fix — pure call, no DB.
Scenario: JOIN 10:00 / LEAVE 11:00.
  T1 Draft,    closed, arrival 10:00              -> 1.0 (was 0.0 pre-fix)
  T2 Completed,closed, arrival 11:00              -> 1.0 (unchanged)
  T3 Completed,closed, end>mission end -> cap     -> 0.5 (cap still works)
  T4 open seg (JOIN only, no LEAVE)               -> runs to mission end 18:00 = 8.0 (unchanged rule)
"""
import sys
from datetime import datetime

sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")
import main

NOW = datetime(2026, 9, 12, 12, 0)

closed = {'start_dt': datetime(2026, 9, 12, 10, 0),
          'end_dt': datetime(2026, 9, 12, 11, 0),
          'start_entry_id': 1, 'end_entry_id': 2}
open_seg = {'start_dt': datetime(2026, 9, 12, 10, 0),
            'end_dt': None, 'start_entry_id': 1, 'end_entry_id': None}

def arr(arrival_time, completion):
    return {'arrival_date': '2026-09-12', 'arrival_time': arrival_time,
            'completion_date': '2026-09-12', 'completion_time': completion}

results = {}
results['T1_draft'] = main.compute_working_hours(arr('10:00', '18:00'), 'Draft', [closed], [], [], now=NOW)
results['T2_completed'] = main.compute_working_hours(arr('11:00', '18:00'), 'Completed', [closed], [], [], now=NOW)
results['T3_completed_cap'] = main.compute_working_hours(arr('10:30', '10:30'), 'Completed', [closed], [], [], now=NOW)
results['T4_open_draft'] = main.compute_working_hours(arr('10:00', '18:00'), 'Draft', [open_seg], [], [], now=NOW)
results['T4_open_active'] = main.compute_working_hours(arr('10:00', '18:00'), 'InProgress', [open_seg], [], [], now=NOW)

print("results:", results)
assert abs(results['T1_draft'] - 1.0) < 1e-9, f"T1 failed: {results['T1_draft']}"
assert abs(results['T2_completed'] - 1.0) < 1e-9, f"T2 failed: {results['T2_completed']}"
assert abs(results['T3_completed_cap'] - 0.5) < 1e-9, f"T3 failed: {results['T3_completed_cap']}"
assert abs(results['T4_open_draft'] - 8.0) < 1e-9, f"T4 failed: {results['T4_open_draft']}"
assert abs(results['T4_open_active'] - 8.0) < 1e-9, f"T4b failed: {results['T4_open_active']}"
print("ALL LOGIC TESTS PASSED")