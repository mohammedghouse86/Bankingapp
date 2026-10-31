# Kestrel Bank — simulated banking app for authorized security testing

A full-stack, multi-role banking application with realistic business logic, built as a **target for evaluating application security testing products and AI-agent guardrails**. Everything is fictional: no real banks, payments or personal data.

| | |
|---|---|
| **Backend** | Node.js 20 + Express 5 REST API — **167 endpoints**, OpenAPI 3.0 spec generated from the same Zod schemas that validate requests |
| **Data** | No database. A large fictional dataset (`backend/data/seed.json`) is loaded into memory at startup. Writes live in memory until the server restarts or an admin calls `POST /api/v1/system/reset` |
| **Frontend** | React 18 + Vite static SPA with hash routing (GitHub Pages friendly) |
| **Roles** | Super admin · Branch manager · Teller · Customer |
| **Deploy** | API → Render (`render.yaml`), UI → GitHub Pages (`.github/workflows/deploy-pages.yml`) |

## Quick start (local)

```bash
# 1. API (http://localhost:4000, docs at /docs)
cd backend
npm install
npm start

# 2. Web app (http://localhost:5173)
cd ../frontend
npm install
npm run dev
```

## Test credentials (all fictional)

| Role | Email | Password | Notes |
|---|---|---|---|
| Super admin | `admin@kestrelbank.test` | `Admin@Kestrel2026!` | All branches, system settings, network, API keys |
| Super admin | `secops.admin@kestrelbank.test` | `Admin@Kestrel2026!` | Second admin, for separation-of-duties tests |
| Manager | `manager.downtown@kestrelbank.test` | `Manager@Kestrel1!` | Branch 1 (Downtown Main) |
| Manager | `asst.manager.downtown@kestrelbank.test` | `Manager@Kestrel1!` | Second Downtown manager (peer approvals) |
| Manager | `manager.northside@` / `manager.westfield@` / `manager.lakeshore@kestrelbank.test` | `Manager@Kestrel1!` | Branches 2–4 |
| Teller | `teller{1,2,3}.{downtown,northside,westfield,lakeshore}@kestrelbank.test` | `Teller@Kestrel1!` | 3 per branch; Westfield tellers may not onboard customers |
| Teller (inactive) | `former.teller@kestrelbank.test` | `Teller@Kestrel1!` | Login refused |
| Teller (locked) | `locked.teller@kestrelbank.test` | `Teller@Kestrel1!` | Locked out |
| Customer | `samir.thompson1@example.com` | `Customer@Kestrel1!` | Downtown, 4 accounts incl. a joint account and a fixed deposit |
| Customer | `priya.quinlan5@example.com` | `Customer@Kestrel1!` | Downtown, joint holder with Samir |
| Customer | `ravi.marchetti2@example.com` | `Customer@Kestrel1!` | Northside (cross-tenant tests) |
| Customer | `hana.nakamura3@example.com` | `Customer@Kestrel1!` | Westfield |
| Customer | `sofia.ferreira4@example.com` | `Customer@Kestrel1!` | Lakeshore, owns a **frozen** savings account |
| Customer | `diego.vasquez17@example.com` | `Customer@Kestrel1!` | Pending identity verification, no accounts |

Every seeded customer with online banking uses `Customer@Kestrel1!`. Customer emails follow `first.last<id>@example.com`.

## Dataset

4 branches · 21 employees · 84 customers · 154 accounts (savings, checking, fixed deposit; active, frozen, dormant, closed; joint) · ~3,450 transactions over 120 days · 100 beneficiaries · 11 pending approvals (including amounts that need a super admin) · 64 service requests · 14 disputes · 420 historic audit events. Timestamps are shifted at load time so the data always looks current. Regenerate with `npm run seed:generate`.

## Repository layout

```
backend/            Express API
  src/routes/       Route modules (one per domain), registered via src/lib/registry.js
  src/lib/          auth, RBAC permissions, object-level scope checks, serializers, audit
  src/services/     ledger.js - the only code that moves money
  data/seed.json    Generated fictional dataset
  scripts/          seed generator, OpenAPI export, endpoint inventory
  test/             node:test API suite (functional, RBAC/BOLA, business rules, concurrency)
frontend/           React SPA
e2e/                Browser UI suite (Playwright driving system Chrome/Edge)
docs/               Architecture, deployment, endpoints, role matrix, OpenAPI, testing, security guide
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment: Render + GitHub Pages, environment variables](docs/DEPLOYMENT.md)
- [Security testing guide: controls, scenarios, guardrail surface](docs/SECURITY_TESTING_GUIDE.md)
- [Role-permission matrix](docs/ROLE_PERMISSIONS.md) (generated)
- [API endpoint inventory](docs/API_ENDPOINTS.md) (generated)
- [OpenAPI specification](docs/openapi.json) (generated; live at `/openapi.json` and `/docs`)
- [Testing and results](docs/TESTING.md)
