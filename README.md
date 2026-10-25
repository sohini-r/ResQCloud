# ResQCloud

ResQCloud is a disaster-management and emergency-response prototype built with React, Vite, React Router, Recharts, Leaflet, and Lucide React. Incident listing and reporting use its local Express/Prisma backend; other response workflows continue to use fictional sample records and browser `localStorage`.

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## Local backend (Step 1)

The backend is a separate Express app in the `server` directory. From a VS Code terminal opened at the project root, install its dependencies and start it in development mode:

```bash
cd server
npm install
npm run dev
```

The server listens on port `5000` by default on both IPv4 and IPv6 loopback addresses, so browser requests to `localhost` work while the API remains local to this computer. Set the `PORT` environment variable to use another port. The Vite frontend origins `http://localhost:5173` and `http://localhost:5176` are permitted by default in development. To permit additional exact origins, set `CORS_ORIGINS` to a comma-separated allowlist. Production requires an explicit `CORS_ORIGINS` allowlist. Check that the server and database are healthy by opening `http://localhost:5000/api/health`; it returns only service/database status, never connection details. To run without watch mode, use `npm start` from the `server` directory.

The frontend uses `http://localhost:5000/api` by default. To choose another backend URL, create a root `.env.local` file:

```dotenv
VITE_API_BASE_URL=http://localhost:5000/api
```

Restart Vite after changing this value. Never put credentials or private secrets in a `VITE_*` variable; Vite embeds these values in browser code.

For a deployed frontend, set `VITE_API_BASE_URL` to the deployed backend API base (for example, `https://YOUR_API_DOMAIN/api`) in the frontend build environment. The development-only fallback to `localhost:5000` is omitted from production builds. If the value is omitted in production, requests use the same origin.

### Prisma and local PostgreSQL setup

Prisma is configured under `server/prisma` and reads `DATABASE_URL` from `server/.env`. Before checking the connection, replace `REPLACE_WITH_LOCAL_PASSWORD` in that local, Git-ignored file with your PostgreSQL password. Do not share or commit the password. From a terminal in `server`, run `npm run db:check` for a read-only `SELECT 1` connection check. The `User` and `Incident` tables are managed by the migration in `server/prisma/migrations`.

## AWS deployment preparation (not deployed)

The Express backend is prepared to listen on `process.env.PORT` (default `5000`). In production it binds to `0.0.0.0` unless `HOST` is explicitly set. Local development retains IPv4 and IPv6 loopback listeners. Backend startup validates its PostgreSQL URL, requires a JWT secret of at least 32 bytes, and requires an explicit production CORS allowlist. Helmet adds standard HTTP security headers. Unhandled API errors return a generic message; server logs record only an error code/name, not request credentials or connection strings.

`server/.env.example` contains placeholders only. Review the variable names and descriptions there; never copy real credentials into a tracked file:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL used by the running backend; production connections must specify `sslmode=require`, `verify-ca`, or `verify-full`. |
| `JWT_SECRET` | Private signing secret; at least 32 bytes. |
| `PORT` | Optional HTTP port; defaults to `5000`. |
| `HOST` | Optional bind address; production defaults to `0.0.0.0`. |
| `NODE_ENV` | Set to `production` by the deployment environment to enable production checks. |
| `CORS_ORIGINS` | Required in production; comma-separated exact frontend origins, without paths. |
| `CLOUD_DATABASE_URL` | Separate cloud PostgreSQL target used only by the guarded migration command. |
| `INITIAL_ADMIN_{1,2,3}_{NAME,EMAIL,PASSWORD}` | Optional inputs to the existing initial-administrator provisioning script; use a managed secret store for real credentials. |
| `VITE_API_BASE_URL` | Frontend build-time backend URL; public configuration only, never a secret. |

Prisma schema and existing migrations are in `server/prisma`; existing migrations create the initial schema and add account-review fields. `npm run build` in `server` generates the Prisma client without connecting to or changing a database. When intentionally preparing a separate cloud database, set `CLOUD_DATABASE_URL` to that TLS-enabled database and run `npm run db:deploy` from `server`. This command invokes only `prisma migrate deploy`, refuses loopback/placeholder/non-TLS targets, and refuses a target matching the configured `DATABASE_URL`; it does not run `migrate reset`, drop data, or use the local URL as a fallback. Prisma client generation and the cloud migration wrapper's missing-target validation do not connect to the local database. The separately named `test:auth` and `test:db` scripts are data-writing smoke tests; they create temporary records and attempt cleanup.

The backend requires Node.js `22.18` or newer because it imports the Prisma 7 generated TypeScript client. A typical future backend build/start sequence is `npm ci`, `npm run build`, then `npm start`, with the runtime environment variables configured by the hosting platform. Configure `CORS_ORIGINS` to the exact deployed frontend origin and `VITE_API_BASE_URL` before building the frontend. No cloud resources have been created and no deployment has been run.

### Docker image and separate migration step

The backend image definition is `server/Dockerfile`; `server/.dockerignore` excludes environment files, generated/local dependencies, Git metadata, and local data. Build and run the application image locally from the `server` directory:

```powershell
docker build -t resqcloud-backend:local .
docker run --rm -p 5000:5000 `
  -e NODE_ENV=production `
  -e PORT=5000 `
  -e DATABASE_URL `
  -e JWT_SECRET `
  -e CORS_ORIGINS `
  resqcloud-backend:local
```

Provide `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS` in the local shell before running the container; do not put secrets in the Dockerfile, build arguments, or image. The image listens on `0.0.0.0` through the existing production server configuration and defaults `PORT` to `5000`. Its Docker health check calls `/api/health`, which returns healthy only when the database query succeeds. Prisma client generation uses a build-only sentinel and does not connect to a database.

Build a separate migration image only when an explicitly approved migration run is intended:

```powershell
docker build --target migrations -t resqcloud-backend-migrations:local .
docker run --rm -e CLOUD_DATABASE_URL resqcloud-backend-migrations:local
```

Supply `CLOUD_DATABASE_URL` through the deployment environment's secret mechanism. This target runs the existing guarded `npm run db:deploy` workflow, which applies committed Prisma migrations to the explicit cloud target; do not run it as part of application startup. No Docker image was built or run, and no migrations were executed as part of this preparation.

### Incident API and authentication

Set a strong, private `JWT_SECRET` in `server/.env` before starting the server. Generate a local value in PowerShell and add it to `.env` (do not paste or commit it):

```powershell
$jwtSecret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
Add-Content .env "JWT_SECRET=$jwtSecret"
Remove-Variable jwtSecret
```

The server requires at least 32 bytes for `JWT_SECRET` and exits with a configuration error if it is missing. Start the backend with `npm run dev` from `server`. Public registration and login are:

- `POST /api/auth/register` — accepts `name`, `email`, `password`, optional `phone`/`address`, and an optional `role` of `CITIZEN`, `VOLUNTEER`, or `SHELTER_MANAGER`. Omitted role defaults to Citizen. Citizens become active immediately; Volunteer and Shelter Manager registrations return `202` with pending status and no token.
- `POST /api/auth/login` — accepts `email` and `password`.

Both successful operations return a bearer access token that expires after one hour and a safe user object without password hashes. Passwords are hashed with bcrypt (12 rounds). Send the token in `Authorization: Bearer <token>` for protected requests. The server verifies the token and loads the user's current role from PostgreSQL for each request.

The server returns a bearer token only to active/approved users. Passwords are hashed with bcrypt (12 rounds) and are never returned. The server reloads each authenticated user's current role and account status from PostgreSQL on every protected request, so a later rejection or suspension blocks existing tokens.

The frontend keeps the bearer token in memory only, not in `localStorage` or `sessionStorage`. This reduces persistent exposure but means refreshing the page signs the user out. Memory-only storage is not fully secure against XSS: script running in the page can still access a token while the app is open. Passwords are sent to the backend and are not saved in frontend state or browser storage.

### Initial administrator setup and role applications

There is no public administrator registration. Provision the three initial Authority Administrator accounts from environment variables using the local, Git-ignored `server/.env` file. Add three unique names, emails, and strong passwords there, without committing or sharing the file:

```dotenv
INITIAL_ADMIN_1_NAME=First Administrator
INITIAL_ADMIN_1_EMAIL=admin1@example.invalid
INITIAL_ADMIN_1_PASSWORD=replace-with-a-strong-private-password
INITIAL_ADMIN_2_NAME=Second Administrator
INITIAL_ADMIN_2_EMAIL=admin2@example.invalid
INITIAL_ADMIN_2_PASSWORD=replace-with-a-different-strong-private-password
INITIAL_ADMIN_3_NAME=Third Administrator
INITIAL_ADMIN_3_EMAIL=admin3@example.invalid
INITIAL_ADMIN_3_PASSWORD=replace-with-another-strong-private-password
```

From `server`, run:

```powershell
npm run admins:provision
```

The script hashes the passwords, provisions exactly these three administrator accounts, prints only a created/total count, and can be rerun without duplicates. It refuses to promote an existing non-administrator account, reactivate an inactive account, or proceed if other administrator accounts exist outside this initial set. Keep the local credentials private; the setup does not echo passwords.

The Authority Administrator navigation includes an Applications workspace with Pending, Approved, and Rejected views. Protected endpoints are `GET /api/admin/applications?status=PENDING|APPROVED|REJECTED`, `GET /api/admin/applications/:id`, `POST /api/admin/applications/:id/approve`, and `POST /api/admin/applications/:id/reject` (JSON `{ "reason": "..." }`). All require an authenticated Authority Administrator. Decisions record the reviewing administrator and timestamp; rejection requires a reason.

Applicants can check status by signing in again: pending applicants receive a pending message, approved users enter their granted role and see an approval notice, and rejected applicants receive the recorded rejection reason. Applicants receive no privileged token before approval.

The available incident endpoints are:

- `GET /api/health` — checks server and database health.
- `GET /api/health/db` — confirms the database connection.
- `GET /api/incidents` — lists incidents newest first; requires authentication.
- `GET /api/incidents/:id` — fetches one incident; requires authentication and returns `404` when it does not exist.
- `POST /api/incidents` — creates an incident for the authenticated user; `reporterId` is derived from the token and cannot be supplied by the caller.

All four authenticated roles (Citizen, Authority Administrator, Volunteer, and Shelter Manager) can view incidents and create reports, as requested. The current API has no update/delete or incident-management endpoint; any future management endpoints must be restricted to Authority Administrators.

The create endpoint accepts this JSON shape. `lat` and `lng` must either both be present or both omitted; `affected` is optional and defaults to zero; `status` is set to `Reported` by the database. Do not include `reporterId`.

```json
{
  "type": "FLOOD",
  "description": "Sample incident for local API testing",
  "location": "Test location",
  "lat": 25.2895,
  "lng": 83.0068,
  "severity": "MEDIUM",
  "affected": 10
}
```

Use PowerShell's built-in HTTP commands to register, log in, and list incidents:

```powershell
$registration = @{
  name = 'Local API Test'
  email = 'replace-with-your-local-test-email@example.invalid'
  password = 'replace-with-a-unique-12-character-password'
} | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/register -ContentType 'application/json' -Body $registration
$headers = @{ Authorization = "Bearer $($session.token)" }
Invoke-RestMethod -Headers $headers http://localhost:5000/api/incidents
```

To log in instead, post the account's email and password to `/api/auth/login` and use the returned token in the same `Authorization` header. A sample incident request is:

```powershell
$body = @{
  type = 'FLOOD'
  description = 'Sample incident for local API testing'
  location = 'Test location'
  severity = 'MEDIUM'
  affected = 10
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/incidents -Headers $headers -ContentType 'application/json' -Body $body
```

`npm test` runs the frontend unit tests and deployment-configuration tests without connecting to PostgreSQL. `server/test/auth-rbac-readonly.test.js` is a separate read-only database integration test. Do not run `npm run test:auth` or `npm run test:db` against a database whose data must remain unchanged: these existing smoke scripts create and update isolated test rows and attempt to clean them up. `npm run db:check` only executes `SELECT 1`.

This is an initial authentication implementation, not a production security certification. Tokens expire after one hour; account status and role are checked against PostgreSQL on each protected request, but there is no general token-revocation/session-management endpoint. Use HTTPS in deployment, protect and rotate the JWT secret, add login rate limiting and operational monitoring, and review privacy/access policies before production use. Incident listing and new incident reports use the backend. Incident status/dispatch updates, evidence images, shelters, resources, volunteers, alerts, and other workflows remain browser-local demo data.

## System roles

Public registration supports immediate Citizen accounts and pending Volunteer or Shelter Manager applications. Only Authority Administrators provisioned through the secure setup process can review applications; approval is required before applicants receive the selected role. Navigation is restricted by role according to response workflows.

Incident reports created through the authenticated reporting form are saved to PostgreSQL. Status changes, shelters, supplies, requests, volunteer tasks, and notification content continue to use browser-local demo data. Notification read status is tracked per local user ID. Evidence images selected in the report form are only previewed locally and are not uploaded yet. Demo evidence images are resized and compressed before local storage; a visible warning is shown if browser storage cannot persist changes. Use **Settings → Reset Dataset** to restore the clean initial state.

The incident map uses OpenStreetMap tiles when network access is available. Only sample incident records with coordinates appear as markers; reports without coordinates remain visible in the map page's incident list.

## Future backend integration

The shared state provider currently implements the application state boundary. It can be replaced with API-backed operations using API Gateway and Lambda, DynamoDB for application records, S3 for evidence uploads, and Cognito for authentication. A backend should preserve the user-ID ownership and shelter-manager ID associations, and store notification read receipts against authenticated user IDs. No AWS services or real notifications are configured in this prototype.
