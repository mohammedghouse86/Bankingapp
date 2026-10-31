/*
 * Browser-level smoke and workflow test for the Kestrel Bank UI.
 *
 * Prerequisites: API running (default http://localhost:4000) and the web app
 * served (default http://localhost:5173), e.g. `npm run dev` in backend/ and
 * `npm run build && npx vite preview --port 5173` in frontend/.
 * Uses the locally installed Chrome (or Edge with BROWSER=msedge).
 *
 * Fails on: console errors, uncaught page errors, unexpected 4xx/5xx API
 * responses, error/"not found"/"access denied" states on pages a role should
 * reach, and horizontal page overflow at phone width.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const WEB = process.env.WEB_URL || 'http://localhost:5173';
const API = process.env.API_URL || 'http://localhost:4000';
const SHOTS = process.env.SCREENSHOT_DIR || '';
const failures = [];
const results = [];

const ROLES = {
  admin: { email: 'admin@kestrelbank.test', password: 'Admin@Kestrel2026!', pages: ['/', '/customers', '/accounts', '/transactions', '/approvals', '/service-requests', '/disputes', '/employees', '/branches', '/reports', '/audit-logs', '/settings', '/security', '/security?tab=keys', '/security?tab=guardrails', '/security?tab=outbox', '/security?tab=reset', '/teller', '/notifications', '/profile', '/profile?tab=security'] },
  manager: { email: 'manager.downtown@kestrelbank.test', password: 'Manager@Kestrel1!', pages: ['/', '/customers', '/accounts', '/teller', '/transactions', '/approvals', '/service-requests', '/disputes', '/employees', '/branches/1', '/reports', '/notifications', '/profile'] },
  teller: { email: 'teller1.downtown@kestrelbank.test', password: 'Teller@Kestrel1!', pages: ['/', '/customers', '/accounts', '/teller', '/transactions', '/transactions?mine=1', '/service-requests', '/disputes', '/branches/1', '/notifications', '/profile'] },
  customer: { email: 'samir.thompson1@example.com', password: 'Customer@Kestrel1!', pages: ['/', '/accounts', '/transfer', '/beneficiaries', '/transactions', '/service-requests', '/disputes', '/notifications', '/profile', '/profile?tab=security'] },
};

// Detail pages reached by clicking the first row of these lists.
const DRILLDOWN = {
  admin: ['/customers', '/accounts', '/transactions', '/employees', '/branches', '/service-requests', '/disputes'],
  manager: ['/customers', '/accounts', '/approvals', '/employees'],
  teller: ['/customers', '/accounts', '/transactions'],
  customer: ['/transactions', '/service-requests', '/disputes'],
};

const BROKEN_TEXT = ['Could not load data', 'Page not found', 'Access denied', 'The page crashed'];

function record(role, page, ok, note = '') {
  results.push({ role, page, ok, note });
  if (!ok) failures.push(`[${role}] ${page}: ${note}`);
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.loading-block, .skeleton'), null, { timeout: 15000 }).catch(() => {});
}

function attachMonitors(page, bucket, role) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // The browser logs every non-2xx fetch; those are judged by the response monitor below.
    if (msg.text().startsWith('Failed to load resource')) return;
    bucket.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => bucket.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    const url = res.url();
    if (!url.startsWith(API) || res.status() < 400) return;
    // Expected: token refresh probes and deliberate validation feedback during workflows.
    if (bucket.allow && bucket.allow.some((re) => re.test(`${res.status()} ${url}`))) return;
    bucket.push(`http ${res.status()} ${res.request().method()} ${url.replace(API, '')}`);
  });
  bucket.role = role;
}

async function login(page, { email, password }) {
  await page.goto(`${WEB}/#/login`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  try {
    await page.waitForSelector('.sidebar', { timeout: 15000 });
  } catch (e) {
    const shown = await page.locator('.alert').allInnerTexts().catch(() => []);
    throw new Error(`login as ${email} did not complete; page shows: ${shown.join(' | ') || '(no alert)'} at ${page.url()}`);
  }
  await settle(page);
}

async function checkPage(page, role, route, bucket) {
  const before = bucket.length;
  await page.goto(`${WEB}/#${route}`);
  await settle(page);
  const text = await page.locator('main.content').innerText().catch(() => '');
  const broken = BROKEN_TEXT.find((t) => text.includes(t));
  const h1 = await page.locator('main.content h1').first().innerText().catch(() => '');
  const errs = bucket.slice(before);
  record(role, route, !broken && !errs.length && Boolean(h1), broken ? `shows "${broken}"` : errs.length ? errs.join(' | ') : !h1 ? 'no page heading rendered' : '');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${role}${route.replace(/[/?=&]/g, '_') || '_home'}.png`), fullPage: false });
}

async function drill(page, role, route, bucket) {
  await page.goto(`${WEB}/#${route}`);
  await settle(page);
  const row = page.locator('tr.clickable').first();
  if (!(await row.count())) { record(role, `${route} → detail`, true, 'no rows to open'); return; }
  const before = bucket.length;
  await row.click();
  await settle(page);
  const url = page.url().split('#')[1];
  const text = await page.locator('main.content').innerText().catch(() => '');
  const broken = BROKEN_TEXT.find((t) => text.includes(t));
  const errs = bucket.slice(before);
  record(role, `${route} → ${url}`, !broken && !errs.length, broken || errs.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${role}_detail${route.replace(/\//g, '_')}.png`) });
}

async function mobileCheck(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  const bucket = [];
  attachMonitors(page, bucket, 'mobile');
  await login(page, ROLES.manager);
  for (const route of ['/', '/customers', '/accounts', '/teller', '/transactions', '/reports', '/customers/1']) {
    await page.goto(`${WEB}/#${route}`);
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record('mobile', route, overflow <= 1, overflow > 1 ? `horizontal page overflow ${overflow}px` : '');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mobile${route.replace(/\//g, '_') || '_home'}.png`) });
  }
  // Navigation drawer opens and navigates.
  await page.click('.menu-btn');
  await page.click('.sidebar.open >> text=Approvals');
  await settle(page);
  record('mobile', 'drawer navigation', page.url().includes('/approvals'), 'drawer did not navigate');
  await ctx.close();
}

async function workflows(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const bucket = [];
  attachMonitors(page, bucket, 'workflow');
  const step = async (name, fn) => {
    const before = bucket.length;
    try {
      await fn();
      const errs = bucket.slice(before);
      record('workflow', name, !errs.length, errs.join(' | '));
    } catch (e) {
      record('workflow', name, false, e.message.split('\n')[0]);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `FAIL_${name.replace(/\W+/g, '_')}.png`) });
    }
  };
  const toast = async (re) => page.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 10000 });

  // Teller: deposit, then a large withdrawal that requires approval.
  await login(page, ROLES.teller);
  let pendingRef = '';
  await step('teller deposit', async () => {
    await page.goto(`${WEB}/#/teller`); await settle(page);
    await page.fill('input[placeholder="e.g. 4001 or Thompson"]', 'Thompson');
    await page.locator('.card button.btn-ghost').first().click();
    await page.locator('form .input-prefix input[type=number]').fill('125.50');
    await page.locator('form input.input').nth(1).fill('Walk-in Depositor');
    await page.click('form button[type=submit]');
    await page.getByText('Transaction completed').waitFor({ timeout: 10000 });
  });
  await step('teller large withdrawal goes to approval', async () => {
    await page.click('text=New transaction');
    await page.click('.tab:has-text("Cash withdrawal")');
    await page.fill('input[placeholder="e.g. 4001 or Thompson"]', '4001107919');
    await page.locator('.card button.btn-ghost').first().click();
    await page.selectOption('form select >> nth=1', 'drivers_license');
    await page.fill('form input.mono', '9725');
    await page.locator('form .input-prefix input[type=number]').fill('6000');
    await page.click('form button[type=submit]');
    await page.getByText('Submitted for approval').waitFor({ timeout: 10000 });
    pendingRef = (await page.locator('.mono').filter({ hasText: /^WDL/ }).first().innerText()).trim();
  });
  await page.click('.user-chip'); await page.click('text=Sign out'); await page.waitForSelector('#email');

  // Manager approves the teller's withdrawal.
  await login(page, ROLES.manager);
  await step('manager approves pending withdrawal', async () => {
    await page.goto(`${WEB}/#/approvals`); await settle(page);
    await page.locator('tr.clickable', { hasText: pendingRef }).first().click();
    await settle(page);
    await page.click('button:has-text("Approve")');
    await page.click('.modal button[type=submit]');
    await toast(/approved/i);
    await page.locator('.page-header .badge', { hasText: 'completed' }).waitFor({ timeout: 10000 });
  });
  await step('manager freezes and unfreezes an account', async () => {
    await page.goto(`${WEB}/#/accounts?status=active`); await settle(page);
    await page.locator('tr.clickable').first().click(); await settle(page);
    await page.click('button:has-text("Freeze")');
    await page.fill('#confirm-reason', 'UI test freeze');
    await page.click('.modal button[type=submit]');
    await toast(/frozen/i);
    await page.click('button:has-text("Unfreeze")');
    await page.fill('#confirm-reason', 'UI test unfreeze');
    await page.click('.modal button[type=submit]');
    await toast(/unfrozen/i);
  });
  await page.click('.user-chip'); await page.click('text=Sign out'); await page.waitForSelector('#email');

  // Customer: own transfer and beneficiary onboarding with OTP from notifications.
  await login(page, ROLES.customer);
  await step('customer transfer between own accounts', async () => {
    await page.goto(`${WEB}/#/transfer`); await settle(page);
    await page.selectOption('form select >> nth=0', { index: 1 });
    await page.selectOption('form select >> nth=1', { index: 1 });
    await page.locator('form .input-prefix input').fill('25');
    await page.click('button:has-text("Review transfer")');
    await page.click('.modal button[type=submit]');
    await page.getByText('Transfer complete').waitFor({ timeout: 10000 });
  });
  await step('customer adds and activates a beneficiary', async () => {
    await page.goto(`${WEB}/#/beneficiaries`); await settle(page);
    await page.click('button:has-text("Add beneficiary")');
    await page.click('.modal .tab:has-text("Other bank")');
    const inputs = page.locator('.modal form input');
    await inputs.nth(0).fill('Evergreen Mutual (Simulated)');
    await inputs.nth(1).fill('999200444');
    await inputs.nth(2).fill('55667788990');
    await inputs.nth(3).fill('UI Test Payee');
    await page.click('.modal button:has-text("Add beneficiary")');
    await page.locator('.modal h2', { hasText: 'Activate' }).waitFor();
    const code = await page.evaluate(async (api) => {
      const s = JSON.parse(sessionStorage.getItem('kestrel.session'));
      const r = await fetch(`${api}/api/v1/notifications?pageSize=5`, { headers: { Authorization: `Bearer ${s.accessToken}` } });
      const j = await r.json();
      return j.data.find((n) => n.title === 'Beneficiary activation code').message.match(/is (\d{6})/)[1];
    }, API);
    await page.fill('.modal input.mono', code);
    await page.click('.modal button:has-text("Activate")');
    await toast(/activated/i);
  });
  await step('customer cannot open another customer\'s account by URL', async () => {
    // Account 120 belongs to another customer (#68) in the seed.
    bucket.allow = [/^404 .*\/accounts\/120$/];
    await page.goto(`${WEB}/#/accounts/120`); await settle(page);
    await page.getByText('Not found').waitFor({ timeout: 10000 });
    bucket.allow = null;
  });
  await page.click('.user-chip'); await page.click('text=Sign out'); await page.waitForSelector('#email');

  // Admin: critical network change requires step-up; guardrail log records it.
  await login(page, ROLES.admin);
  await step('admin network change with step-up', async () => {
    await page.goto(`${WEB}/#/security`); await settle(page);
    await page.click('button:has-text("Edit configuration")');
    const gw = page.locator('.modal .field:has(label:text-is("Gateway"))').locator('input');
    await gw.fill('10.20.4.254');
    await page.locator('.modal .field', { hasText: 'Change reason' }).locator('input').fill('CHG-1234 gateway migration');
    // 428 STEP_UP_REQUIRED is the expected first response.
    bucket.allow = [/^428 .*\/system\/network$/];
    await page.click('.modal button:has-text("Apply changes")');
    await page.fill('#stepup-pw', ROLES.admin.password);
    await page.click('.modal button:has-text("Confirm")');
    await toast(/Network configuration updated/);
    bucket.allow = null;
    await page.goto(`${WEB}/#/security?tab=guardrails`); await settle(page);
    await page.locator('td', { hasText: '/api/v1/system/network' }).first().waitFor({ timeout: 10000 });
  });
  await ctx.close();
}

/** Restore the seed so workflows are repeatable (uses the documented admin account). */
async function resetData() {
  const { email, password } = ROLES.admin;
  const login = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (login.status === 429) throw new Error('Rate limited; start the API with RATE_LIMIT_MAX=10000 AUTH_RATE_LIMIT_MAX=1000 for UI test runs');
  const { data } = await login.json();
  const r = await fetch(`${API}/api/v1/system/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.accessToken}`, 'X-Confirm-Password': password }, body: JSON.stringify({ confirm: 'RESET ALL DATA' }) });
  if (!r.ok) throw new Error(`data reset failed: ${r.status}`);
}

async function main() {
  try {
    const r = await fetch(`${API}/health`);
    if (!r.ok) throw new Error();
  } catch { console.error(`API not reachable at ${API}`); process.exit(2); }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  await resetData();
  const browser = await chromium.launch({ channel: process.env.BROWSER || 'chrome', headless: true });
  for (const [role, cfg] of Object.entries(ROLES)) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const bucket = [];
    attachMonitors(page, bucket, role);
    await login(page, cfg);
    for (const route of cfg.pages) await checkPage(page, role, route, bucket);
    for (const route of DRILLDOWN[role]) await drill(page, role, route, bucket);
    // Browser refresh keeps the session and the current page.
    await page.goto(`${WEB}/#${cfg.pages[1]}`); await settle(page);
    await page.reload(); await settle(page);
    record(role, 'refresh keeps session', page.url().endsWith(cfg.pages[1]) && (await page.locator('.sidebar').count()) === 1, 'lost session or route after reload');
    await ctx.close();
  }
  await mobileCheck(browser);
  await workflows(browser);
  await browser.close();

  const ok = results.filter((r) => r.ok).length;
  results.filter((r) => !r.ok).forEach((r) => console.log(`FAIL [${r.role}] ${r.page} :: ${r.note}`));
  console.log(`\nUI checks: ${ok}/${results.length} passed`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
