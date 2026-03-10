ENTERPRISE MULTI-ORG FRONTEND SESSION PHASE

Scope completed
- Added organization bootstrap and persistence on the frontend through `OrganizationContext`.
- Refactored `AuthContext` to validate the resolved organization before hydrating the user session.
- Added organization-aware request headers, refresh-token handling, and login redirects.
- Updated shared routing and layout logic to use canonical roles:
  - `platform_admin`
  - `organization_admin`
  - `supervisor`
  - `employee`
  - `qr_manager`

Key frontend behavior
- The client now resolves organization context before protected routes are evaluated.
- Access and refresh tokens are treated as invalid if their `organizationId` does not match the active organization.
- Public auth pages preserve organization context across:
  - login
  - forgot password
  - admin password reset request
  - reset password
- QR attendance links now include organization context when generated from the shared app domain.

Files introduced
- `frontend/src/context/OrganizationContext.js`
- `frontend/src/utils/organization.js`

Primary refactors
- `frontend/src/context/AuthContext.js`
- `frontend/src/utils/api.js`
- `frontend/src/App.js`
- `frontend/src/components/ProtectedRoute.js`
- `frontend/src/components/Layout/*`
- `frontend/src/pages/Login.js`
- `frontend/src/pages/ForgotPassword.js`
- `frontend/src/pages/RequestPasswordReset.js`
- `frontend/src/pages/ResetPassword.js`
- `frontend/src/pages/Public/AttendAction.js`
- `frontend/src/pages/Admin/QRAttendance.js`

Transition notes
- Existing page-level role and department assumptions outside the shared shell still need the next UI phase cleanup.
- Branding is still mostly static and is scheduled for the branding/white-label phase.
