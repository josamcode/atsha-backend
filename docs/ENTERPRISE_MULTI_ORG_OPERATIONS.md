## Enterprise Operations Phase

Phase 7 makes the remaining business modules organization-safe.

### Updated APIs

- `GET /api/attendance/validate/:token`
- `POST /api/attendance/qr/generate`
- `GET /api/attendance/qr/current`
- `POST /api/attendance/qr/cleanup`
- `POST /api/attendance/check-absent`
- `POST /api/attendance/record`
- `GET /api/attendance/my-attendance`
- `GET /api/attendance/stats`
- `GET /api/attendance/logs`
- `GET /api/attendance/logs/grouped`
- `PUT /api/attendance/logs/:id`
- `GET /api/leaves`
- `GET /api/leaves/:id`
- `POST /api/leaves`
- `PUT /api/leaves/:id`
- `DELETE /api/leaves/:id`
- `PUT /api/leaves/:id/approve`
- `PUT /api/leaves/:id/cancel`
- `GET /api/leaves/stats/summary`
- `GET /api/leaves/my-balance`
- `GET /api/messages`
- `GET /api/messages/sent`
- `GET /api/messages/conversation/:userId`
- `GET /api/messages/unread-count`
- `GET /api/messages/:id`
- `POST /api/messages`
- `PUT /api/messages/:id/read`
- `PUT /api/messages/read-all`
- `DELETE /api/messages/:id`
- `DELETE /api/messages`
- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PUT /api/notifications/:id/read`
- `PUT /api/notifications/read-all`
- `DELETE /api/notifications/:id`
- `DELETE /api/notifications`
- `GET /api/dashboard/summary`

### Access model

- `platform_admin`
  can act on attendance and leave administration for any requested organization that resolves successfully
- `organization_admin`
  can manage attendance and leave operations across the active organization
- `supervisor`
  can view and approve leave data only for allowed departments, and can only view attendance data for allowed departments
- `qr_manager`
  can manage QR generation and attendance operations inside the active organization, but does not gain leave administration
- `employee`
  stays limited to self-service attendance, leave, messages, notifications, and dashboard data

### Tenant behavior

- Attendance QR validation now requires a resolved organization and only accepts tokens from that organization
- Attendance token sequencing, active-token expiry, cleanup, attendance writes, and late notifications are now organization-scoped
- Manual absent-user checks and the shared `checkAbsentUsers` utility now run per organization
- Leave list, read, create, update, delete, cancel, approve, stats, notifications, and admin email recipients are now organization-scoped
- Message inbox, sent mail, conversations, unread counts, read actions, and deletes are now organization-scoped
- Broadcast messages are restricted to same-organization recipients only
- Notification reads, counts, and deletes are now organization-scoped
- Dashboard summary counts and recent items are now organization-scoped, and supervisor dashboard data is constrained to managed departments
- Dashboard cache keys now include `organizationId` so cached summaries cannot leak across tenants

### Audit coverage added in this phase

- attendance token creation
- attendance log manual updates
- leave request creation
- leave request update
- leave request deletion
- leave request cancellation
- leave request approval
- leave request rejection

### Compatibility notes

- `GET /api/dashboard/summary` now treats `qr_manager` as a self-service dashboard role rather than an organization-wide dashboard role
- Leave notifications remain admin-recipient notifications, but recipients are now isolated to the same organization
- Existing pre-migration attendance, leave, message, and notification records without `organizationId` still need the backfill phase to appear under tenant-scoped queries

### Deferred to the next phases

- frontend organization-aware attendance, leaves, notifications, messages, and dashboard pages
- enterprise branding refactor for server CORS, email identity, and PDF identity
- migration execution and integrity validation
- automated tenant isolation tests
