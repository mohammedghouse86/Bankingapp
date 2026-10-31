# Testing

## Suites

| Suite | Location | Command | What it covers |
|---|---|---|---|
| API tests | `backend/test/*.test.js` | `cd backend && npm test` | Runs in-process with Node's test runner and supertest; each file gets a fresh copy of the dataset |
| Lint | `backend`, `frontend` | `npm run lint` | ESLint (undefined variables, unused code, React hook rules) |
| UI tests | `e2e/ui-smoke.mjs` | see below | Real browser (system Chrome via `playwright-core`) against the running API and built SPA |

### API test files

- **auth.test.js:** login for all roles; generic errors; lockout; locked and inactive users; refresh rotation and reuse detection; logout revocation; forged and `alg:none` JWTs; password change and strength; forgot/reset via outbox (single use, no user enumeration); self-registration (age, duplicates, mass assignment); session isolation.
- **authorization.test.js:** BOLA/IDOR across 16 object routes; customer list isolation; BFLA (customer calling 12 staff/admin functions); mass assignment on accounts and profile; teller limits; manager branch confinement; privilege escalation attempts; branch onboarding policy; excessive data exposure; API key scopes.
- **banking.test.js:** deposits and ledger; amount validation; withdrawal identity checks; holds and approvals; separation of duties; authority limits; frozen/dormant/closed/fixed-deposit restrictions; freeze cycle; insufficient funds; destination rules for customers and tellers; beneficiary OTP and limits; online limits and approval thresholds; **25-way concurrent transfer race**; idempotency; immutability and reversals; dispute refunds; account opening and fixed deposits; closure; KYC separation of duties.
- **admin.test.js:** step-up; guardrail event logging (executed, blocked, unauthenticated); admin IP enforcement and lockout protection; grantable-permission bounds; settings validation (including a `__proto__` key); branch limit caps; employee lifecycle; customer contact change with old-address alert; PII export; data reset.
- **coverage.test.js:** the OpenAPI document covers every route (≥100, unique operation IDs, all `$ref`s resolve); **every GET endpoint as 5 principals** returns no 5xx and requires auth; **every mutating endpoint with 5 malformed bodies** returns no 5xx; 404, malformed JSON and 413 handling; security headers and CORS.
- **ratelimit.test.js:** login throttling returns 429 with rate-limit headers.

### UI test

```bash
# terminal 1 - API with relaxed rate limits (the crawler sends many requests from one IP)
cd backend && RATE_LIMIT_MAX=10000 AUTH_RATE_LIMIT_MAX=1000 npm start
# terminal 2 - built SPA
cd frontend && npm run build && npx vite preview --port 5173 --strictPort
# terminal 3
cd e2e && npm install && npm test          # BROWSER=msedge to use Edge; SCREENSHOT_DIR=... to save screenshots
```

The script resets the dataset first, then for each role:
- signs in through the login form
- visits every page in the role's navigation and opens detail pages from list rows
- reloads the browser to check the session and route persist
- at 390 px width, checks for horizontal overflow and that the navigation drawer works

It then runs these workflows end to end:
- teller deposit
- teller withdrawal above the limit, which goes to approval
- manager approves it
- manager freezes and unfreezes an account
- customer transfers between own accounts
- customer adds a beneficiary and activates it with the OTP from notifications
- customer tries another customer's account by URL and sees "Not found"
- admin changes the network configuration through the step-up prompt, and the change appears in the guardrail log

A check fails on any console error, uncaught exception, unexpected 4xx/5xx API response, an error/"not found"/"access denied" state on a reachable page, or a missing page heading.

## Results (executed 2026-10-31, Windows 11, Node 20.2.0, Chrome)

| Suite | Result |
|---|---|
| Backend ESLint | 0 errors, 0 warnings |
| Frontend ESLint | 0 errors, 0 warnings |
| Frontend production build | Succeeds (430 kB JS / 117 kB gzip) |
| API tests | **60 / 60 passed** |
| UI tests | **92 / 92 checks passed**, 3 consecutive runs |
| Production boot | Refuses to start without `JWT_SECRET`; starts with it (167 endpoints) |

Issues found and fixed during testing:
- Volume charts counted pending (unapproved) deposits.
- SVG chart text scaled up on wide screens.
- The mobile menu button showed on desktop.
- A hook was called conditionally on the transactions page.
- React key warnings in detail lists.
- Seeded audit events showed customers performing teller actions.

## Not covered

- Real deployment to Render and GitHub Pages: the configuration is provided but was not deployed from this environment.
- Cross-browser testing beyond Chromium (Chrome/Edge).
- `npm audit` reports a moderate advisory in esbuild via Vite 5. It affects only the local dev server, not the built site. The fix requires Vite 6+/Node 20.19+.
