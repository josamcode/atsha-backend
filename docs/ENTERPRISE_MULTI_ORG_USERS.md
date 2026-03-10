## Enterprise User Management Phase

Phase 5 makes the user-management backend organization-safe.

### Updated APIs

- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`
- `PUT /api/users/:id/reset-password`
- `GET /api/users/password-reset-requests`
- `GET /api/users/admin`
- `POST /api/users/:id/send-report`

### Access model

- `platform_admin`
  can list and manage users for any organization by passing `organizationId`
- `organization_admin`
  can manage users only inside the active organization
- `supervisor`
  can list and read users only inside the active organization and only for their allowed departments
- `employee`
  can read only their own user record

### Tenant behavior

- User list, search, counts, password-reset requests, and admin lookup are now scoped by `organizationId`
- User create and update validate `department` and supervisor `departments` against `Organization.departments`
- User create and update return legacy `role` plus canonical `organizationRole`
- Admin notifications created from user management are now written only for the same organization

### Audit coverage added in this phase

- user creation
- user update
- user role change
- user deletion
- admin password reset
- employee report email send

### Compatibility notes

- Organization-admin assignments are still stored with the legacy `admin` role value so older business controllers continue to work until their refactor phases land
- Platform admins must pass `organizationId` when operating on a non-active organization

### Deferred to the next phases

- organization-safe forms controllers
- organization-safe attendance, leave, message, notification, and dashboard controllers
- frontend organization-aware user-management screens
