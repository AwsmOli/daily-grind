# Daily Grind

PWA app for collaborative TODOs and recurring daily tasks with a points and rewards system.

Primary backend: Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging).

## 1. Product Vision

Daily Grind helps small teams (families, roommates, friend groups, study teams) coordinate recurring responsibilities and reward follow-through using a shared points economy.

## 2. Problem Statement

Most task apps focus on individual productivity. Teams need:
- shared ownership of recurring tasks
- lightweight accountability
- simple rewards and penalties with history
- mobile-first, real-time collaboration

## 3. Goals and Non-Goals

### Goals
- Make task status and assignment visible to everyone in real time.
- Support recurring tasks with cooldown logic.
- Track point balances and every balance change in a ledger.
- Allow one team lead to create a workspace and invite others quickly.
- Work on mobile, desktop, and in poor connectivity situations (PWA/offline-first UX).

### Non-Goals (v1)
- No complex enterprise permissions beyond team roles.
- No advanced analytics dashboards.
- No external payment integration.
- No multi-organization admin console.

## 4. Target Users

- Team Lead: Creates team, manages members, defines task lists, adjusts points.
- Team Member: Completes tasks, tracks points, redeems rewards, collaborates.

## 5. Core Features

### 5.0 First-Run Onboarding Flow
- On first app open, show two choices only:
  - `Join a Team`
  - `Create a Team`
- If user selects `Join a Team`, open QR scanner immediately.
- If user selects `Create a Team`, require email sign-up before team creation.

### 5.1 Lists and Tasks
- Create, edit, delete lists.
- Create, edit, delete tasks.
- Share lists with team members.
- Add point values to tasks.
- Add cooldown to recurring tasks.
- Manage multiple lists per team.
- Support two task visibilities for team members and team lead:
  - `Personal TODOs` visible only to creator
  - `Shared TODOs` visible to the full team

### 5.2 Board Workflow
- Trello-like board with `Todo`, `In Progress`, and `Done` columns.
- When moving a task to `In Progress`, assign current user if unassigned.
- When moving a task to `Done`, assign current user (or keep existing assignee).
- Optionally reopen task by moving back to `Todo`.

### 5.3 Team Management
- Team lead must sign up with email and then create team.
- Join flow is QR-first and opens scanner immediately.
- Invite links/codes can be created after team setup.
- Every invite must include an intended member name.
- Members can still join by invite link when shared digitally.
- Role management: `admin`, `member`.
- Invite and remove members.
- Assign tasks to specific members.
- Real-time updates for task changes and point changes.

### 5.4 Points and Rewards
- Team setup must define a points unit:
  - examples: `USD`, `EUR`, `Credits`, `Stars`, `Coins`
  - include both a display name and optional symbol
- Reward points when tasks are completed.
- Manual point add/deduct by admin.
- Members can deduct points from themselves.
- Every point change creates a ledger entry.
- Ledger entries require a note for all manual adjustments.
- Monetary/point values support 2 decimal places (`0.01` precision).
- Redeem points via:
  - task completion (automatic reward)
  - manual redemption by admin (requires note)

### 5.5 Notifications
- Time-based notifications for tasks approaching or exiting cooldown.
- Push notifications only.

### 5.6 Platform and UX
- Responsive design for mobile and desktop.
- PWA install support.
- Offline-capable interactions with sync on reconnect.
- User authentication and profile management.
- Consistent decimal formatting in UI for point values (always 2 decimals).

## 6. MVP Scope (Phase 1)

Build first:
- Team creation with required email sign-up.
- QR scanner join flow.
- Invite codes/links with required intended member name.
- Lists/tasks CRUD.
- Board with drag/drop status changes.
- Task completion rewards points.
- Ledger for all point changes.
- Manual point add/deduct (admin) with required note.
- Member self-deduct with required note.
- Firebase Auth + Firestore Security Rules for role-based access.
- Firestore offline persistence with conflict-safe server-side writes for balance updates.

Post-MVP:
- QR invites.
- Advanced recurring task scheduling rules.
- Reward catalog/store UX enhancements.

## 7. User Stories

- As a new user, I can choose between joining a team and creating one on first open.
- As a new member, I can open a QR scanner immediately to join a team quickly.
- As a team lead, I can create a team so I can onboard my group.
- As a team lead, I can create invite links/codes with a member name so invites are explicit and trackable.
- As a member, I can view shared task boards so I know what to do.
- As a team member, I can create personal TODOs only I can see.
- As a team member, I can create shared TODOs visible to the whole team.
- As a member, I can move a task to done so my completion is visible and rewarded.
- As an admin, I can adjust points with a note so there is accountability.
- As a member, I can deduct my own points with a note so spending stays transparent.
- As any member, I can view the ledger so disputes can be resolved with history.

## 8. Permissions Rules (Draft)

- `admin`
  - full task/list management
  - invite/remove members
  - manual point adjustments for any member
  - manage roles
- `member`
  - create/update tasks in allowed lists
  - update task status and assignment (within team)
  - self point deduction with mandatory note
  - cannot change team roles or delete team

## 9. Data Model (Draft)

Suggested Firestore collections/subcollections:
- `teams/{teamId}`
  - name, pointsUnitName, pointsUnitCode, pointsUnitSymbol, createdBy, createdAt
- `teams/{teamId}/members/{userId}`
  - role (`admin` | `member`), joinedAt, status
- `teams/{teamId}/inviteLinks/{inviteId}`
  - token, expiresAt, createdBy, type, intendedMemberName, useLimit, usedCount
- `teams/{teamId}/lists/{listId}`
  - name, createdBy, archivedAt
- `teams/{teamId}/tasks/{taskId}`
  - listId, title, description, status, assigneeUserId, visibility (`personal` | `shared`), ownerUserId, pointsMinor, cooldownHours, recurringRule, dueAt, createdBy, updatedAt
- `teams/{teamId}/taskEvents/{eventId}`
  - taskId, actorUserId, eventType, payload, createdAt
- `teams/{teamId}/pointAccounts/{userId}`
  - balanceMinor
- `teams/{teamId}/pointLedger/{entryId}`
  - userId, deltaMinor, balanceAfterMinor, reasonType, note, relatedTaskId, actorUserId, createdAt
- `users/{userId}/pushTokens/{tokenId}`
  - token, platform, lastSeenAt, enabled

Numeric storage recommendation (Firebase):
- Store all point amounts as integer minor units (`minor = major * 100`).
- Example: `12.34` is stored as `1234`.
- Convert to 2-decimal display format only in UI.
- Never store points as floating numbers.

## 10. Technical Architecture

### Frontend
- Vue 3 + Vite
- Pinia for state management
- Vue Router
- Tailwind CSS
- Drag and drop library for board interactions
- Service worker via Workbox for caching/offline

### Backend (Firebase)
- Firebase Auth (email link/password/OAuth)
- Cloud Firestore for primary data + realtime listeners
- Firestore Security Rules for team/role access control
- Cloud Functions for trusted business logic (ledger writes, balance updates, scheduled cooldown checks)
- Firebase Cloud Messaging for push notifications
- Scheduled Functions/Cloud Scheduler for due/cooldown notifications

### Offline Strategy
- Cache static assets via Workbox.
- Use Firestore offline persistence for local-first reads/writes.
- Route all balance/ledger mutations through Cloud Functions transactions to avoid race conditions.
- Show conflict resolution UI if server-confirmed state differs from optimistic UI.

## 11. Milestones

### Milestone 1: Foundation
- Initialize Vue app + first-run join/create chooser.
- Implement email sign-up for create-team flow.
- Implement Firestore collections and Security Rules.
- Add QR join flow.
- Add invite link/code flow with required intended member name.
- Add team points unit setup during team creation.

### Milestone 2: Task System
- Lists/tasks CRUD.
- Board columns and drag/drop state updates.
- Realtime sync.

### Milestone 3: Points Economy
- Automatic reward on completion.
- Admin adjustments + member self-deduct.
- Ledger views and filtering.

### Milestone 4: Recurring + Cooldowns
- Cooldown timers and recurrence handling.
- Push notifications.

### Milestone 5: PWA and Polish
- Installable PWA.
- Offline fallback and retry queue.
- Mobile UX polish and accessibility pass.

## 12. Success Metrics

- Weekly active teams.
- Tasks completed per active team per week.
- Percentage of tasks completed on time.
- Ratio of manual point adjustments to task-earned points.
- 7-day and 30-day retention by team.

## 13. Risks and Mitigations

- Risk: point abuse or disputes.
  - Mitigation: immutable ledger entries + mandatory notes + admin audit view.
- Risk: offline conflicts.
  - Mitigation: event log, last-write safeguards, conflict prompts.
- Risk: notification fatigue.
  - Mitigation: user-level notification preferences.

## 14. Open Questions

- Should members be allowed to create new lists, or only admins?
- Should point balances be per team only, or global per user?
- What are default cooldown behaviors for recurring tasks?
- Should task completion require proof/comment (optional note, photo)?
- Should invite links be single-use or multi-use?

Decisions locked for v1:
- Each team chooses its own points unit at creation and can rename it later.
- All point amounts are stored and displayed with exactly 2 decimal places.

## 15. Suggested Tech Stack

- Vue 3 (frontend)
- Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging)
- Tailwind CSS (styling)
- Vite (build tooling)
- Workbox (PWA support)