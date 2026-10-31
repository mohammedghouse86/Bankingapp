# Deployment

No database is needed. The API serves its in-memory dataset from `backend/data/seed.json`, which is committed to the repository.

## 1. Push to GitHub

Create a repository and push this folder (the `main` branch is used by the workflows).

## 2. API on Render

**Option A — Blueprint (recommended).** In Render: *New → Blueprint*, select the repository. `render.yaml` creates a free web service with:

- root directory `backend`, build `npm ci --omit=dev`, start `npm start`, health check `/health`
- `NODE_ENV=production`, `TRUST_PROXY=1`, and a generated `JWT_SECRET`

When prompted, set **`CORS_ORIGINS`** to your GitHub Pages origin, e.g. `https://<your-user>.github.io` (origin only — no path, no trailing slash).

**Option B — manual web service.** Runtime Node, root directory `backend`, same commands and environment variables as above.

After the deploy, check `https://<service>.onrender.com/health` and the interactive docs at `/docs`.

> The free plan sleeps after inactivity. A cold start restores the seed, because data is in memory by design, and takes up to a minute. Use a paid instance if testers need state to survive idle periods.

## 3. Frontend on GitHub Pages

1. Repository *Settings → Pages → Build and deployment → Source: GitHub Actions*.
2. *Settings → Secrets and variables → Actions → Variables*: add **`API_URL`** = `https://<service>.onrender.com`.
3. Push to `main`, or run the **Deploy frontend to GitHub Pages** workflow manually. The site is published at `https://<your-user>.github.io/<repo>/`.

Routing uses URL hashes (`/#/accounts/12`), so deep links and refreshes work on GitHub Pages without 404 rewrites. The build uses relative asset paths, so any repository name works.

**API URL:** `frontend/public/config.js` points GitHub Pages hosts at `https://bankingapp-kpp3.onrender.com`; change it there (or in the deployed `config.js`) if the Render URL changes. The `API_URL` repository variable is only a fallback.

## Environment variables (API)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Listen port (Render sets it automatically) |
| `NODE_ENV` | `development` | `production` makes `JWT_SECRET` mandatory |
| `JWT_SECRET` | dev-only value | HMAC key for access tokens — **required in production** |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated browser origins allowed to call the API (`*` allows any) |
| `ACCESS_TOKEN_TTL_SECONDS` | `14400` (4 hours) | Access token lifetime. Tokens stay valid until this expiry even after logout |
| `REFRESH_TOKEN_TTL_SECONDS` | `43200` | Session (refresh token) lifetime |
| `RATE_LIMIT_MAX` | `600` | Requests per minute per IP across the API |
| `AUTH_RATE_LIMIT_MAX` | `30` | Per 15 minutes per IP for login, registration, password reset, refresh, account lookup |
| `TRUST_PROXY` | `1` in production, `loopback` otherwise | Express trust-proxy setting (real client IP for rate limits and audit) |
| `AUTO_RESET_MINUTES` | `0` | Periodically restore the seed (0 = disabled) |
| `SEED_FILE` | `data/seed.json` | Alternate dataset |

Automated scanners and crawlers can trip the default rate limits from a single IP. That is intended realistic behavior; raise `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` if a scan needs higher throughput.

## Environment variables (web)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base URL baked into the build (the Pages workflow sets it from the `API_URL` repository variable) |
