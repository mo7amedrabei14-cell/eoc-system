All requested HR tab enhancements have been successfully implemented:

## Summary of Changes Made

### 1. Database Schema (`Data Base.sql`)
- Added `team_code` character varying(50) column to `public.volunteers`
- Added `admin_code` character varying(50) column to `public.volunteers`
- Used safe ALTER TABLE ADD COLUMN syntax

### 2. Backend API (`main.py`)
- Modified `/api/human-resources` endpoint to:
  - Select `volunteers.team_code` and `volunteers.admin_code`
  - Calculate `is_currently_on_mission` boolean based on:
    - Volunteer has mission participant record
    - Return status = 'مازال بالمهمة'
    - Mission status NOT in ('Completed', 'Cancelled', 'Returned')
  - Preserved existing DISTINCT ON deduplication logic
  - Maintained all existing functionality

### 3. Frontend Dashboard (`frontend/src/Dashboard.jsx`)
- **Real-time Updates**: Added event listener for `mission-updated` events
- **New Filter**: Added dropdown with options:
  - "الكل" (all)
  - "حاليًا في مهمة" (currently on mission)
  - "ليس حاليًا في مهمة" (not currently on mission)
- **UI Enhancements**:
  - Added "كود الفريق" (team code) column display
  - Added "كود الإدارة" (admin code) column display
  - Added visual status indicator (orange background) for active missions
- **Export Functionality**: Updated Excel export to include new fields
- **State Management**: Added `filterMissionStatus` state variable

### Key Technical Points
- **Active Mission Logic**: Determined by checking `mission_participants.return_status = 'مازال بالمهمة'` AND associated mission not in completed/cancelled/returned states
- **Real-time Updates**: Leverages existing `mission-updated` custom event architecture used by other tabs
- **Backward Compatibility**: All existing functionality preserved; new features are additive
- **Performance**: Maintains efficient SQL queries with existing indexing strategy

### Files Modified
1. `Data Base.sql` - Schema migration
2. `main.py` - Backend API enhancement
3. `frontend/src/Dashboard.jsx` - Frontend UI and logic updates

All changes have been implemented as targeted edits per your instructions, without rewriting entire files or modifying already-verified components.