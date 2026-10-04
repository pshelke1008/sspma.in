/**
 * Responsive and runtime QA sweep.
 *
 * Drives a real browser through every route at the target viewports and
 * reports console errors, failed requests, horizontal overflow and any
 * occurrence of forbidden wording — in English and again in Marathi, whose
 * longer labels are the likelier to overflow. Screenshots land in tests/screenshots.
 *
 *   npm run qa
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type ConsoleMessage, type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const WEB = process.env.QA_WEB_URL ?? 'http://localhost:5173';
const API = process.env.QA_API_URL ?? 'http://localhost:4300/api';
const EMAIL = process.env.QA_EMAIL ?? 'admin@ashram.org';
const PASSWORD = 'Ashram@2026';
const SHOTS = path.resolve(__dirname, 'screenshots');

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '430x932', width: 430, height: 932 },
  { name: '390x844', width: 390, height: 844 },
  { name: '375x812', width: 375, height: 812 },
];

const ROUTES = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/finance', name: 'finance' },
  { path: '/expenses', name: 'expenses' },
  { path: '/expenses/new', name: 'expense-wizard' },
  { path: '/approvals', name: 'approvals' },
  { path: '/reports', name: 'reports' },
  { path: '/reports/income-expense', name: 'report-income-expense' },
  { path: '/donations', name: 'donations' },
  { path: '/donors', name: 'donors' },
  { path: '/donors/:donorId', name: 'donor-profile' },
  { path: '/donors?tab=broadcasts', name: 'donor-broadcasts' },
  { path: '/purchases', name: 'purchases' },
  { path: '/banking', name: 'banking' },
  { path: '/settings', name: 'settings' },
  { path: '/settings/users', name: 'settings-users' },
  { path: '/settings/roles', name: 'settings-roles' },
  { path: '/settings/audit-logs', name: 'settings-audit' },
  { path: '/settings/organization', name: 'settings-organization' },
  { path: '/settings/chart-of-accounts', name: 'settings-accounts' },
  { path: '/settings/financial-year', name: 'settings-financial-year' },
  { path: '/settings/data', name: 'settings-data' },
  { path: '/settings/profile', name: 'settings-profile' },
  { path: '/settings/whatsapp', name: 'settings-whatsapp' },
];

/** Retired or banned wording that must never reach the screen. */
const FORBIDDEN = /trustee|vendor|ashram erp|\bschool\b/i;

/** Routes swept at every viewport; the rest are checked desktop + phone. */
const FULL_SWEEP = new Set(['/dashboard', '/expenses', '/expenses/new', '/approvals', '/reports/income-expense']);

let problems = 0;
const report: string[] = [];

function fail(message: string) {
  problems += 1;
  report.push(message);
  console.log(`  \x1b[31m✗\x1b[0m ${message}`);
}

function pass(message: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${message}`);
}

/** Noise a dev server produces that says nothing about the application. */
function isIgnorableConsoleError(text: string): boolean {
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[vite]') ||
    text.includes('favicon') ||
    text.includes('ResizeObserver loop')
  );
}

async function checkPage(
  page: Page,
  route: { path: string; name: string },
  viewport: { name: string; width: number },
  locale: 'en' | 'mr' = 'en',
) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error' && !isIgnorableConsoleError(message.text())) {
      consoleErrors.push(message.text());
    }
  };
  const onResponse = (response: { status: () => number; url: () => string }) => {
    // 401/403/404 are legitimate API answers the UI handles; 5xx is not.
    if (response.status() >= 500) failedRequests.push(`${response.status()} ${response.url()}`);
  };

  page.on('console', onConsole);
  page.on('response', onResponse);

  await page.goto(`${WEB}${route.path}`, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(700);

  const label = `${route.path} @ ${viewport.name}${locale === 'mr' ? ' [mr]' : ''}`;

  if (locale === 'mr') {
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== 'mr') fail(`${label}: document language is "${lang}", expected "mr"`);
  }

  // Horizontal overflow: the page body must never scroll sideways.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  if (overflow.scrollWidth > overflow.clientWidth + 2) {
    fail(`${label}: horizontal overflow (${overflow.scrollWidth}px content in ${overflow.clientWidth}px viewport)`);
  }

  // Forbidden wording anywhere in the rendered document.
  const forbidden = await page.evaluate((pattern) => new RegExp(pattern, 'i').test(document.body.innerText), FORBIDDEN.source);
  if (forbidden) fail(`${label}: forbidden wording found in rendered text`);

  // The route must actually render something.
  const textLength = await page.evaluate(() => document.body.innerText.trim().length);
  if (textLength < 40) fail(`${label}: page rendered almost no content (${textLength} chars)`);

  if (consoleErrors.length) fail(`${label}: console error — ${consoleErrors[0].slice(0, 160)}`);
  if (failedRequests.length) fail(`${label}: server error — ${failedRequests[0].slice(0, 160)}`);

  // Accessibility audit on the widest viewport, where the full layout renders.
  if (viewport.width === 1440) {
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const violation of serious) {
      fail(`${label}: a11y — ${violation.id} (${violation.nodes.length}× ${violation.impact}) ${violation.help}`);
    }
  }

  if (!consoleErrors.length && !failedRequests.length && overflow.scrollWidth <= overflow.clientWidth + 2 && !forbidden) {
    pass(label);
  }

  await page.screenshot({
    path: path.join(SHOTS, `${route.name}-${viewport.name}${locale === 'mr' ? '-mr' : ''}.png`),
    fullPage: viewport.width >= 1024,
  });

  page.off('console', onConsole);
  page.off('response', onResponse);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  console.log(`\n\x1b[1mAshram Management — responsive & runtime QA\x1b[0m`);
  console.log(`Web: ${WEB}\n`);

  const browser = await chromium.launch();

  // ---- Login screen, before authenticating ----
  console.log('\x1b[1mLogin screen\x1b[0m');
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await checkPage(page, { path: '/login', name: 'login' }, viewport);
    await context.close();
  }

  /** Saves the admin's language to their profile, exactly as the switcher does. */
  async function setLocale(page: Page, locale: 'en' | 'mr') {
    const status = await page.evaluate(
      async ({ api, locale }) =>
        (
          await fetch(`${api}/auth/me/preferences`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale }),
          })
        ).status,
      { api: API, locale },
    );
    if (status !== 200) throw new Error(`Could not switch language to ${locale} (${status})`);
  }

  async function signIn(page: Page) {
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard/, { timeout: 20_000 });
  }

  async function resolve(page: Page, route: { path: string; name: string }) {
    if (!route.path.includes(':donorId')) return route;
    const donorId = await page.evaluate(
      async (api) => (await (await fetch(`${api}/donors?pageSize=1&sortBy=totalDonated&sortDir=desc`, { credentials: 'include' })).json()).data[0].id,
      API,
    );
    return { ...route, path: route.path.replace(':donorId', donorId) };
  }

  // ---- Authenticated sweep ----
  for (const viewport of VIEWPORTS) {
    const routes = ROUTES.filter(
      (route) => FULL_SWEEP.has(route.path) || viewport.name === '1440x900' || viewport.name === '390x844',
    );
    if (routes.length === 0) continue;

    console.log(`\n\x1b[1m${viewport.name}\x1b[0m`);

    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();

    await signIn(page);
    await setLocale(page, 'en');

    for (const route of routes) {
      await checkPage(page, await resolve(page, route), viewport);
    }

    await context.close();
  }

  // ---- Marathi sweep: every route, desktop and phone ----
  for (const viewport of VIEWPORTS.filter((item) => item.name === '1440x900' || item.name === '390x844')) {
    console.log(`\n\x1b[1m${viewport.name} — मराठी\x1b[0m`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await signIn(page);
    await setLocale(page, 'mr');
    try {
      for (const route of ROUTES) {
        await checkPage(page, await resolve(page, route), viewport, 'mr');
      }
    } finally {
      await setLocale(page, 'en');
      await context.close();
    }
  }

  await browser.close();

  console.log(`\n${'─'.repeat(60)}`);
  if (problems === 0) {
    console.log(`  \x1b[32mNo issues found.\x1b[0m Screenshots in tests/screenshots`);
  } else {
    console.log(`  \x1b[31m${problems} issue${problems === 1 ? '' : 's'} found:\x1b[0m`);
    for (const item of report) console.log(`   • ${item}`);
  }
  console.log(`${'─'.repeat(60)}\n`);

  process.exit(problems > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('QA run crashed:', error);
  process.exit(1);
});
