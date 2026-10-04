/**
 * End-to-end workflow check against a running API.
 *
 * Exercises the complete financial path — create → submit → approve → pay →
 * accounting → reporting → audit — plus RBAC and tenant isolation.
 *
 *   npm run test:e2e
 */
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * By default the suite manages its own database and API process so a run is
 * repeatable. Point E2E_API_URL at a server to test an existing deployment
 * instead — the database is then left untouched.
 */
const EXTERNAL = Boolean(process.env.E2E_API_URL);
const TEST_PORT = Number(process.env.E2E_PORT ?? 4399);
const BASE = process.env.E2E_API_URL ?? `http://localhost:${TEST_PORT}/api`;
const PASSWORD = 'Ashram@2026';
const ROOT = path.resolve(__dirname, '../../../..');

/**
 * The suite drops and reseeds its database, so it must never run against the
 * development or a production database. It uses TEST_DATABASE_URL, or else the
 * DATABASE_URL with `_test` appended to the database name, and refuses any
 * database whose name does not end in `_test`.
 */
function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const source = explicit ?? process.env.DATABASE_URL;
  if (!source) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) before running the e2e suite');
  const url = new URL(source);
  if (!explicit) url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${name}": the e2e database name must end in "_test"`);
  }
  return url.toString();
}

/**
 * A stand-in for Meta's Graph API, so "Connect with Facebook" runs end to end
 * without a real Meta app: code exchange, token inspection, account and number
 * discovery, number verification and the webhook subscription.
 */
const GRAPH_PORT = Number(process.env.E2E_GRAPH_PORT ?? 4398);
const META_APP_ID = 'e2e-meta-app';
const graphCalls: { method: string; path: string; auth: string | null }[] = [];
let graphServer: http.Server | null = null;
/** A tiny JPEG (just the magic bytes plus padding) standing in for a photo a donor sends. */
const E2E_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const E2E_PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(60, 32)]);

/** Posts a Meta webhook signed exactly as Meta signs it. */
async function postWebhook(payload: unknown) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET ?? '').update(raw).digest('hex')}`;
  const response = await fetch(`${BASE}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body: raw,
  });
  // Processing happens after the 200; give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return response.status;
}

function inboundPayload(phoneNumberId: string, from: string, name: string, message: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [{ from, id: `wamid.in.${Date.now()}.${Math.random()}`, ...message }],
            },
          },
        ],
      },
    ],
  };
}

function startFakeGraph(): Promise<void> {
  const routes: Record<string, (url: URL) => unknown> = {
    'GET /v21.0/oauth/access_token': (url) =>
      url.searchParams.get('grant_type') === 'fb_exchange_token'
        ? { access_token: 'e2e-long-lived-token', expires_in: 60 * 86_400 }
        : url.searchParams.get('code') === 'e2e-code'
          ? { access_token: 'e2e-short-token' }
          : { error: { code: 100, message: 'Invalid verification code' } },
    'GET /v21.0/debug_token': () => ({
      data: {
        is_valid: true,
        app_id: META_APP_ID,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 86_400,
        granular_scopes: [
          { scope: 'whatsapp_business_management', target_ids: ['111111111', '222222222'] },
          // Only 111111111 may send; 222222222 is management-only and must be skipped.
          { scope: 'whatsapp_business_messaging', target_ids: ['111111111'] },
        ],
      },
    }),
    'GET /v21.0/111111111': () => ({ name: 'E2E Ashram WABA' }),
    'GET /v21.0/111111111/phone_numbers': () => ({
      data: [
        { id: '900000001', display_phone_number: '+91 98200 00001', verified_name: 'E2E Ashram', quality_rating: 'GREEN' },
        { id: '900000002', display_phone_number: '+91 98200 00002', verified_name: 'E2E Ashram Office', quality_rating: 'YELLOW' },
      ],
    }),
    'GET /v21.0/900000002': () => ({ display_phone_number: '+91 98200 00002', verified_name: 'E2E Ashram Office', quality_rating: 'YELLOW' }),
    'POST /v21.0/111111111/subscribed_apps': () => ({ success: true }),
    'GET /v21.0/900000001': () => ({ display_phone_number: '+91 98200 00001', verified_name: 'E2E Ashram', quality_rating: 'GREEN' }),
    'POST /v21.0/900000001/messages': () => ({ messages: [{ id: `wamid.out.${graphCalls.length}` }] }),
    'POST /v21.0/900000002/messages': () => ({ messages: [{ id: `wamid.out.${graphCalls.length}` }] }),
    'POST /v21.0/900000001/media': () => ({ id: 'e2e-uploaded-media' }),
    'GET /v21.0/e2e-inbound-photo': () => ({ url: `http://localhost:${GRAPH_PORT}/files/e2e-inbound-photo`, mime_type: 'image/jpeg', file_size: E2E_JPEG.length }),
    'GET /files/e2e-inbound-photo': () => E2E_JPEG,
  };
  graphServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${GRAPH_PORT}`);
    graphCalls.push({ method: req.method ?? 'GET', path: url.pathname, auth: req.headers.authorization ?? null });
    const handler = routes[`${req.method} ${url.pathname}`];
    const body = handler ? handler(url) : { error: { code: 803, message: 'Unknown path' } };
    if (Buffer.isBuffer(body)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(body);
      return;
    }
    res.writeHead(body && typeof body === 'object' && 'error' in body ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => graphServer!.listen(GRAPH_PORT, resolve));
}

if (!EXTERNAL) {
  process.env.WHATSAPP_GRAPH_URL = `http://localhost:${GRAPH_PORT}`;
  process.env.WHATSAPP_GRAPH_VERSION = 'v21.0';
  process.env.WHATSAPP_APP_ID = META_APP_ID;
  process.env.WHATSAPP_APP_SECRET ||= 'e2e-app-secret';
  process.env.API_PUBLIC_URL = `http://localhost:${TEST_PORT}`;
  // Child processes (prisma, the seed and the API) inherit this, and an
  // existing environment variable wins over the root .env file.
  process.env.DATABASE_URL = testDatabaseUrl();
  console.log(`  Using test database ${new URL(process.env.DATABASE_URL).pathname.slice(1)}`);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];
let apiProcess: ChildProcess | null = null;

function stopApi() {
  if (apiProcess && !apiProcess.killed) apiProcess.kill('SIGTERM');
  graphServer?.close();
  apiProcess = null;
}

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    if (detail !== undefined) console.log(`      ${JSON.stringify(detail).slice(0, 400)}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

interface Session {
  token: string;
  name: string;
  role: string;
  permissions: string[];
  organization: string;
}

async function call<T = any>(
  session: Session | null,
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; data: T; headers: Headers }> {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get('content-type') ?? '';
  let data: unknown;
  if (contentType.includes('application/json')) data = await response.json();
  else data = Buffer.from(await response.arrayBuffer());

  return { status: response.status, data: data as T, headers: response.headers };
}

async function login(identifier: string): Promise<Session> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`Login failed for ${identifier}: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as any;
  return {
    token: payload.token,
    name: payload.user.name,
    role: payload.user.role.name,
    permissions: payload.user.permissions,
    organization: payload.user.organization.name,
  };
}

/**
 * The suite writes real records, so it reseeds first. Without this a second run
 * would measure a database the first run had already changed.
 */
function reseed() {
  console.log('  Resetting the database to a known seed…');
  execFileSync(
    'npx',
    ['prisma', 'migrate', 'reset', '--force', '--schema', 'database/schema/schema.prisma', '--skip-seed'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  execFileSync('npx', ['tsx', 'database/seed/seed.ts'], { cwd: ROOT, stdio: 'ignore' });
}

/**
 * A fresh API process is started after the reseed. A server that was already
 * running would still hold Postgres type OIDs from the dropped schema, and
 * every enum-bearing write would fail with "cache lookup failed for type".
 */
async function startApi(): Promise<ChildProcess> {
  console.log('  Starting an API process for the run…');
  const child = spawn('npx', ['tsx', 'apps/api/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, API_PORT: String(TEST_PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs: string[] = [];
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return child;
    } catch {
      /* not listening yet */
    }
  }

  child.kill('SIGTERM');
  throw new Error(`API did not start on port ${TEST_PORT}.\n${logs.join('')}`);
}

async function main() {
  console.log(`\n\x1b[1mAshram Management — end-to-end workflow\x1b[0m`);
  console.log(`API: ${BASE}\n`);

  if (!EXTERNAL) {
    reseed();
    await startFakeGraph();
    apiProcess = await startApi();
    console.log('');
  }

  const health = await call(null, 'GET', '/health');
  if (health.status !== 200) {
    console.error(`API is not reachable at ${BASE}.`);
    process.exit(1);
  }

  // ---------------------------------------------------------------- Auth ---
  section('1. Authentication');

  const accountant = await login('accounts@ashram.org');
  check('Accountant signs in', accountant.role === 'Accountant', accountant.role);

  const approver = await login('approver@ashram.org');
  check('Approver signs in', approver.role === 'Approver', approver.role);

  const admin = await login('admin@ashram.org');
  check('Admin signs in', admin.role === 'Admin User', admin.role);

  const otherOrg = await login('admin@sadhanakendra.org');
  check('Second organization signs in', otherOrg.organization === 'Sadhana Kendra', otherOrg.organization);

  const badLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'accounts@ashram.org', password: 'wrong-password' }),
  });
  check('Wrong password is rejected', badLogin.status === 401, badLogin.status);

  const noAuth = await call(null, 'GET', '/expenses');
  check('Protected route rejects an anonymous request', noAuth.status === 401, noAuth.status);

  // --------------------------------------------------------- Dashboard ---
  section('2. Dashboard and finance figures');

  const dashboard = await call(accountant, 'GET', '/dashboard');
  const stats = (dashboard.data as any).stats;
  check('Dashboard returns live figures', dashboard.status === 200 && typeof stats.totalBalance === 'number');
  check(`Total balance is ₹24,50,000 (got ${stats.totalBalance})`, stats.totalBalance === 2_450_000, stats);
  check(`Income is ₹8,20,000 (got ${stats.income})`, stats.income === 820_000);
  check(`Expenses are ₹6,80,000 (got ${stats.expenses})`, stats.expenses === 680_000);
  check(`Payables are ₹1,85,000 (got ${stats.payables})`, stats.payables === 185_000);
  check(`Net surplus is ₹1,40,000 (got ${stats.netSurplus})`, stats.netSurplus === 140_000);

  const finance = await call(accountant, 'GET', '/finance/overview');
  check('Finance overview loads', finance.status === 200 && (finance.data as any).stats.income === 820_000);

  // ------------------------------------------------------------- RBAC ---
  section('3. Role-based access control (server-side)');

  const approverCreate = await call(approver, 'POST', '/expenses', {
    date: new Date().toISOString().slice(0, 10),
    title: 'Approver should not be able to create this',
    departmentId: 'x',
    fundId: 'x',
    categoryId: 'x',
    items: [{ description: 'x', quantity: 1, unit: 'NOS', rate: 1, taxRate: 0 }],
  });
  check('Approver cannot create an expense (403)', approverCreate.status === 403, approverCreate.data);

  const accountantApproveRoute = await call(accountant, 'POST', '/expenses/does-not-exist/approve', {});
  check('Accountant cannot reach the approve route (403)', accountantApproveRoute.status === 403, accountantApproveRoute.status);

  const accountantUsers = await call(accountant, 'GET', '/users');
  check('Accountant cannot list users (403)', accountantUsers.status === 403, accountantUsers.status);

  const adminUsers = await call(admin, 'GET', '/users');
  check('Admin can list users', adminUsers.status === 200);

  const accountantAudit = await call(accountant, 'GET', '/audit-logs');
  check('Accountant cannot read audit logs (403)', accountantAudit.status === 403, accountantAudit.status);

  // --------------------------------------------------- Expense creation ---
  section('4. Expense creation and server-side calculation');

  const masters = (await call(accountant, 'GET', '/masters')).data as any;
  const gaushala = masters.departments.find((d: any) => d.name === 'Gaushala');
  const gaushalaFund = masters.funds.find((f: any) => f.name === 'Gaushala Fund');
  const cowShed = masters.costCenters.find((c: any) => c.name === 'Cow Shed 1');
  const feedCategory = masters.categories.find((c: any) => c.name === 'Cattle Feed');
  const supplier = masters.suppliers.find((v: any) => v.name === 'ABC Fodder Supplier');
  const sbi = masters.bankAccounts.find((b: any) => b.name.startsWith('SBI'));

  check('Masters are scoped and populated', Boolean(gaushala && gaushalaFund && feedCategory && supplier && sbi));

  const created = await call(accountant, 'POST', '/expenses', {
    date: new Date().toISOString().slice(0, 10),
    title: 'E2E — Gaushala Feed',
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    costCenterId: cowShed.id,
    categoryId: feedCategory.id,
    supplierId: supplier.id,
    description: 'Created by the end-to-end workflow test',
    items: [
      { description: 'Green Fodder', quantity: 500, unit: 'KG', rate: 8, taxRate: 0 },
      { description: 'Dry Fodder', quantity: 300, unit: 'KG', rate: 10, taxRate: 0 },
    ],
    payImmediately: false,
  });

  const expense = created.data as any;
  check('Expense is created', created.status === 201 && Boolean(expense.id), created.data);
  check('Expense number is allocated', /^EXP-\d{4}-\d{5}$/.test(expense.expenseNumber ?? ''), expense.expenseNumber);
  check('Status starts at DRAFT', expense.status === 'DRAFT', expense.status);
  check(`Subtotal computed server-side = 7000 (got ${expense.subtotal})`, expense.subtotal === 7000);
  check(`Total computed server-side = 7000 (got ${expense.total})`, expense.total === 7000);

  // A tampered client total must be ignored — the server recomputes from lines.
  const tampered = await call(accountant, 'POST', '/expenses', {
    date: new Date().toISOString().slice(0, 10),
    title: 'E2E — tampered totals',
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    categoryId: feedCategory.id,
    subtotal: 1,
    tax: 1,
    total: 1,
    items: [{ description: 'Item', quantity: 2, unit: 'NOS', rate: 1000, taxRate: 18 }],
    payImmediately: false,
  });
  const tamperedExpense = tampered.data as any;
  check('Client-supplied totals are ignored (2×1000 +18% = 2360)', tamperedExpense.total === 2360, tamperedExpense.total);

  const invalid = await call(accountant, 'POST', '/expenses', {
    date: new Date().toISOString().slice(0, 10),
    title: 'x',
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    categoryId: feedCategory.id,
    items: [],
    payImmediately: false,
  });
  check('Validation rejects an expense with no items (422)', invalid.status === 422, invalid.status);

  const futureDate = await call(accountant, 'POST', '/expenses', {
    date: '2099-01-01',
    title: 'Future dated',
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    categoryId: feedCategory.id,
    items: [{ description: 'x', quantity: 1, unit: 'NOS', rate: 10, taxRate: 0 }],
    payImmediately: false,
  });
  check('Validation rejects a future-dated expense (422)', futureDate.status === 422, futureDate.status);

  // ---------------------------------------------------- Tenant isolation ---
  section('5. Tenant isolation');

  const crossRead = await call(otherOrg, 'GET', `/expenses/${expense.id}`);
  check('Other organization cannot read this expense (404)', crossRead.status === 404, crossRead.status);

  const crossList = (await call(otherOrg, 'GET', '/expenses?pageSize=100')).data as any;
  const leaked = crossList.data?.some((row: any) => row.id === expense.id);
  check('Other organization list never contains it', leaked === false);

  const otherMasters = (await call(otherOrg, 'GET', '/masters')).data as any;
  const masterLeak = otherMasters.departments.some((d: any) => d.id === gaushala.id);
  check('Master data does not cross organizations', masterLeak === false);

  const crossApprove = await call(otherOrg, 'POST', `/expenses/${expense.id}/approve`, {});
  check('Other organization cannot approve it (404)', crossApprove.status === 404, crossApprove.status);

  // ----------------------------------------------------------- Workflow ---
  section('6. Approval workflow');

  const earlyPay = await call(accountant, 'POST', `/expenses/${expense.id}/pay`, {
    amount: 7000,
    method: 'CASH',
    paymentDate: new Date().toISOString().slice(0, 10),
  });
  check('A draft cannot be paid (invalid transition)', earlyPay.status === 409, earlyPay.status);

  const submitted = await call(accountant, 'POST', `/expenses/${expense.id}/submit`, {
    comments: 'Monthly fodder purchase',
  });
  check('Submit moves the expense to PENDING_APPROVAL', (submitted.data as any).status === 'PENDING_APPROVAL', submitted.data);

  const doubleSubmit = await call(accountant, 'POST', `/expenses/${expense.id}/submit`, {});
  check('Submitting twice is refused', doubleSubmit.status === 409, doubleSubmit.status);

  const editWhilePending = await call(accountant, 'PUT', `/expenses/${expense.id}`, {
    date: new Date().toISOString().slice(0, 10),
    title: 'Should not be editable',
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    categoryId: feedCategory.id,
    items: [{ description: 'x', quantity: 1, unit: 'NOS', rate: 10, taxRate: 0 }],
    payImmediately: false,
  });
  check('Cannot edit while awaiting approval', editWhilePending.status === 409, editWhilePending.status);

  const approvals = (await call(approver, 'GET', '/approvals?tab=pending&pageSize=100')).data as any;
  const inQueue = approvals.data.find((row: any) => row.id === expense.id);
  check('Expense appears in the approver queue', Boolean(inQueue));
  check('Approval card carries budget context', typeof inQueue?.budget?.remaining === 'number');

  const badReject = await call(approver, 'POST', `/expenses/${expense.id}/reject`, { reason: 'no' });
  check('Reject requires a real reason (422)', badReject.status === 422, badReject.status);

  const approved = await call(approver, 'POST', `/expenses/${expense.id}/approve`, { comments: 'Within budget' });
  check('Approver approves the expense', (approved.data as any).status === 'APPROVED', approved.data);
  check('Approved-by is recorded', (approved.data as any).approvedBy?.name === approver.name);

  const reApprove = await call(approver, 'POST', `/expenses/${expense.id}/approve`, {});
  check('Approving twice is refused', reApprove.status === 409, reApprove.status);

  // Separation of duties: a Finance Manager can create and approve, but not
  // decide on their own request — that needs expense.approve_own.
  const financeManager = await login('finance@ashram.org');
  const ownExpense = (
    await call(financeManager, 'POST', '/expenses', {
      date: new Date().toISOString().slice(0, 10),
      title: 'E2E — self approval attempt',
      departmentId: gaushala.id,
      fundId: gaushalaFund.id,
      categoryId: feedCategory.id,
      items: [{ description: 'Item', quantity: 1, unit: 'NOS', rate: 500, taxRate: 0 }],
      payImmediately: false,
    })
  ).data as any;
  await call(financeManager, 'POST', `/expenses/${ownExpense.id}/submit`, {});
  const selfApprove = await call(financeManager, 'POST', `/expenses/${ownExpense.id}/approve`, {});
  check('Finance Manager cannot approve their own expense (403)', selfApprove.status === 403, selfApprove.data);
  const selfReject = await call(financeManager, 'POST', `/expenses/${ownExpense.id}/reject`, {
    reason: 'Trying to reject my own request',
  });
  check('…nor reject it (403)', selfReject.status === 403, selfReject.data);

  // ------------------------------------------------- Admin on behalf ---
  section('6b. Admin raising expenses on behalf of others');

  const userOptions = (await call(admin, 'GET', '/users/options')).data as any;
  const accountantUser = userOptions.data.find((u: any) => u.role.key === 'ACCOUNTANT');
  check('Admin can list users to raise an expense for', Boolean(accountantUser), userOptions);

  const accountantOptions = await call(accountant, 'GET', '/users/options');
  check('Accountant cannot list users for on-behalf entry (403)', accountantOptions.status === 403, accountantOptions.status);

  const expenseBody = (title: string, extra: Record<string, unknown> = {}) => ({
    date: new Date().toISOString().slice(0, 10),
    title,
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    categoryId: feedCategory.id,
    items: [{ description: 'Item', quantity: 2, unit: 'NOS', rate: 750, taxRate: 0 }],
    payImmediately: false,
    ...extra,
  });

  const onBehalf = await call(admin, 'POST', '/expenses', expenseBody('E2E — raised for the accountant', { onBehalfOfId: accountantUser.id }));
  const onBehalfExpense = onBehalf.data as any;
  check('Admin raises an expense on behalf of the accountant', onBehalf.status === 201, onBehalf.data);
  check('The expense records who it was raised for', onBehalfExpense.onBehalfOf?.id === accountantUser.id, onBehalfExpense.onBehalfOf);

  const accountantView = await call(accountant, 'GET', `/expenses/${onBehalfExpense.id}`);
  check('The accountant can see the expense raised for them', accountantView.status === 200, accountantView.status);

  await call(admin, 'POST', `/expenses/${onBehalfExpense.id}/submit`, {});
  const adminApprovesOnBehalf = await call(admin, 'POST', `/expenses/${onBehalfExpense.id}/approve`, {});
  check('Admin approves the expense they raised on behalf of someone', (adminApprovesOnBehalf.data as any).status === 'APPROVED', adminApprovesOnBehalf.data);

  const adminOwn = (await call(admin, 'POST', '/expenses', expenseBody('E2E — admin own expense'))).data as any;
  await call(admin, 'POST', `/expenses/${adminOwn.id}/submit`, {});
  const adminDetail = (await call(admin, 'GET', `/expenses/${adminOwn.id}`)).data as any;
  check('Approve is offered to the admin on their own pending expense', adminDetail.abilities?.canApprove === true, adminDetail.abilities);
  const adminSelfApprove = await call(admin, 'POST', `/expenses/${adminOwn.id}/approve`, {});
  check('Admin can approve their own expense (expense.approve_own)', (adminSelfApprove.data as any).status === 'APPROVED', adminSelfApprove.data);

  const accountantOnBehalf = await call(accountant, 'POST', '/expenses', expenseBody('E2E — own id in the on-behalf field', { onBehalfOfId: accountantUser.id }));
  check(
    'Raising for yourself via onBehalfOfId is treated as your own expense',
    accountantOnBehalf.status === 201 && !(accountantOnBehalf.data as any).onBehalfOf,
    accountantOnBehalf.data,
  );
  const adminUser = userOptions.data.find((u: any) => u.role.key === 'ADMIN');
  const accountantForOther = await call(accountant, 'POST', '/expenses', expenseBody('E2E — not allowed', { onBehalfOfId: adminUser.id }));
  check('Accountant cannot raise an expense on behalf of someone else (403)', accountantForOther.status === 403, accountantForOther.data);

  const crossOrgUser = await call(admin, 'POST', '/expenses', expenseBody('E2E — cross org', { onBehalfOfId: 'not-a-member' }));
  check('On-behalf user must belong to the organization (400)', crossOrgUser.status === 400, crossOrgUser.data);

  // ------------------------------------------------------------ Payment ---
  section('7. Payment and accounting');

  const overPay = await call(accountant, 'POST', `/expenses/${expense.id}/pay`, {
    amount: 99_999,
    method: 'BANK_TRANSFER',
    bankAccountId: sbi.id,
    referenceNumber: 'E2E-OVER',
    paymentDate: new Date().toISOString().slice(0, 10),
  });
  check('Overpayment is refused', overPay.status === 400, overPay.status);

  const missingRef = await call(accountant, 'POST', `/expenses/${expense.id}/pay`, {
    amount: 7000,
    method: 'BANK_TRANSFER',
    bankAccountId: sbi.id,
    paymentDate: new Date().toISOString().slice(0, 10),
  });
  check('Bank transfer without a reference is refused (422)', missingRef.status === 422, missingRef.status);

  const paid = await call(accountant, 'POST', `/expenses/${expense.id}/pay`, {
    amount: 7000,
    method: 'BANK_TRANSFER',
    bankAccountId: sbi.id,
    referenceNumber: 'E2E-NEFT-0001',
    paymentDate: new Date().toISOString().slice(0, 10),
  });
  const settled = paid.data as any;
  check('Payment is recorded', paid.status === 200 && settled.paymentStatus === 'PAID', settled.paymentStatus);
  check('Status advances to ACCOUNTING_POSTED', settled.status === 'ACCOUNTING_POSTED', settled.status);
  check('Balance due is zero', settled.balanceDue === 0, settled.balanceDue);
  check('A payment record exists', settled.payments?.length === 1);

  const journal = settled.transactions?.[0];
  check('A journal voucher was posted', Boolean(journal), settled.transactions);
  if (journal) {
    const debit = journal.lines.reduce((sum: number, line: any) => sum + line.debit, 0);
    const credit = journal.lines.reduce((sum: number, line: any) => sum + line.credit, 0);
    check(`Journal balances (Dr ${debit} = Cr ${credit})`, debit === credit && debit === 7000);
    const debitLine = journal.lines.find((line: any) => line.debit > 0);
    const creditLine = journal.lines.find((line: any) => line.credit > 0);
    check('Debit hits the expense ledger', debitLine?.account.type === 'EXPENSE', debitLine?.account);
    check('Credit hits the bank ledger', creditLine?.account.type === 'ASSET', creditLine?.account);
  }

  const payAgain = await call(accountant, 'POST', `/expenses/${expense.id}/pay`, {
    amount: 100,
    method: 'CASH',
    paymentDate: new Date().toISOString().slice(0, 10),
  });
  check('A settled expense cannot be paid again', payAgain.status === 409, payAgain.status);

  const editSettled = await call(accountant, 'PUT', `/expenses/${expense.id}`, {
    date: new Date().toISOString().slice(0, 10),
    title: 'Trying to edit a posted expense',
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    categoryId: feedCategory.id,
    items: [{ description: 'x', quantity: 1, unit: 'NOS', rate: 10, taxRate: 0 }],
    payImmediately: false,
  });
  check('A posted expense cannot be edited in place', editSettled.status === 409, editSettled.status);

  const deleteSettled = await call(admin, 'DELETE', `/expenses/${expense.id}`);
  check('A posted expense cannot be deleted', deleteSettled.status === 409, deleteSettled.status);

  // ----------------------------------------------------------- Revision ---
  section('8. Revision of a posted expense');

  const revision = await call(admin, 'POST', `/expenses/${expense.id}/revise`, {
    reason: 'Supplier issued a corrected invoice',
  });
  const revised = revision.data as any;
  check('Revision draft is created', revision.status === 201 && revised.status === 'DRAFT', revision.data);
  check('Revision references the original', revised.revisionOf === expense.id);
  check('Revision number increments', revised.revisionNumber === 2, revised.revisionNumber);

  const originalAfter = (await call(admin, 'GET', `/expenses/${expense.id}`)).data as any;
  const reversal = originalAfter.transactions.find((t: any) => t.isReversal);
  check('Original journal entry is reversed, not erased', Boolean(reversal), originalAfter.transactions.length);
  if (reversal) {
    const net = originalAfter.transactions.reduce(
      (sum: number, t: any) => sum + t.lines.reduce((s: number, l: any) => s + l.debit - l.credit, 0),
      0,
    );
    check('Reversal nets the ledger back to zero', Math.abs(net) < 0.01, net);
  }

  // ------------------------------------------------------------ Reports ---
  section('9. Reports and exports');

  const reportKeys = [
    'income-expense',
    'balance-sheet',
    'trial-balance',
    'general-ledger',
    'cash-flow',
    'cash-book',
    'fund-report',
    'department-pl',
    'budget-vs-actual',
    'expense-analysis',
    'donor-report',
    'donation-summary',
    'supplier-outstanding',
    'payment-report',
  ];

  for (const reportKey of reportKeys) {
    const report = await call(accountant, 'GET', `/reports/${reportKey}/data`);
    const payload = report.data as any;
    check(
      `Report "${reportKey}" returns data (${payload?.rows?.length ?? 0} rows)`,
      report.status === 200 && Array.isArray(payload.rows) && Array.isArray(payload.columns),
      report.data,
    );
  }

  const trial = (await call(accountant, 'GET', '/reports/trial-balance/data')).data as any;
  const difference = trial.summary.find((s: any) => s.label === 'Difference');
  check(`Trial balance balances (difference ${difference?.value})`, Math.abs(difference?.value ?? 1) < 1, difference);

  const ie = (await call(accountant, 'GET', '/reports/income-expense/data')).data as any;
  const totalIncome = ie.summary.find((s: any) => s.label === 'Total Income');
  const liveDashboard = (await call(accountant, 'GET', '/dashboard')).data as any;
  check(
    'Income & Expense report agrees with the dashboard',
    totalIncome?.value === liveDashboard.stats.income,
    { report: totalIncome?.value, dashboard: liveDashboard.stats.income },
  );
  const totalExpense = ie.summary.find((s: any) => s.label === 'Total Expense');
  check(
    'Income & Expense report agrees with the dashboard expenses',
    totalExpense?.value === liveDashboard.stats.expenses,
    { report: totalExpense?.value, dashboard: liveDashboard.stats.expenses },
  );

  const pdf = await call(accountant, 'GET', '/reports/income-expense/export?format=pdf');
  const pdfBuffer = pdf.data as unknown as Buffer;
  check(
    `PDF export produces a real PDF (${pdfBuffer.length} bytes)`,
    pdf.status === 200 && pdfBuffer.subarray(0, 5).toString() === '%PDF-' && pdfBuffer.length > 1000,
    pdf.status,
  );

  const excel = await call(accountant, 'GET', '/reports/income-expense/export?format=excel');
  const xlsxBuffer = excel.data as unknown as Buffer;
  check(
    `Excel export produces a real XLSX (${xlsxBuffer.length} bytes)`,
    excel.status === 200 && xlsxBuffer.subarray(0, 2).toString() === 'PK' && xlsxBuffer.length > 1000,
    excel.status,
  );

  const csv = await call(accountant, 'GET', '/reports/income-expense/export?format=csv');
  const csvText = (csv.data as unknown as Buffer).toString();
  check('CSV export contains the filtered rows', csv.status === 200 && csvText.includes('Income') && csvText.split('\r\n').length > 4);

  const filteredCsv = await call(
    accountant,
    'GET',
    `/reports/expense-analysis/export?format=csv&departmentId=${gaushala.id}`,
  );
  check('Export respects the applied filters', filteredCsv.status === 200 && (filteredCsv.data as unknown as Buffer).toString().includes('Gaushala'));

  const approverExport = await call(approver, 'GET', '/reports/income-expense/export?format=csv');
  check('Approver with export rights can export', approverExport.status === 200, approverExport.status);

  const marathiData = (await call(accountant, 'GET', '/reports/income-expense/data?lang=mr')).data as any;
  check('Report data is localised to Marathi on request', /[\u0900-\u097F]/.test(JSON.stringify(marathiData.columns)), marathiData.columns);

  const marathiCsv = await call(accountant, 'GET', '/reports/income-expense/export?format=csv&lang=mr');
  check('Marathi CSV export uses Devanagari headings', /[\u0900-\u097F]/.test((marathiCsv.data as unknown as Buffer).toString()));

  const marathiPdf = await call(accountant, 'GET', '/reports/income-expense/export?format=pdf&lang=mr');
  const marathiPdfBuffer = marathiPdf.data as unknown as Buffer;
  check(
    'Marathi PDF export renders with an embedded Devanagari font',
    marathiPdf.status === 200 && marathiPdfBuffer.subarray(0, 5).toString() === '%PDF-' && marathiPdfBuffer.toString('latin1').includes('Mukta'),
    marathiPdf.status,
  );

  // -------------------------------------------------------- Expense PDF ---
  section('10. Expense voucher PDF');

  const voucher = await call(accountant, 'GET', `/expenses/${expense.id}/pdf`);
  const voucherBuffer = voucher.data as unknown as Buffer;
  check(
    `Expense voucher renders as PDF (${voucherBuffer.length} bytes)`,
    voucher.status === 200 && voucherBuffer.subarray(0, 5).toString() === '%PDF-',
  );

  const crossVoucher = await call(otherOrg, 'GET', `/expenses/${expense.id}/pdf`);
  check('Voucher is not readable across organizations', crossVoucher.status === 404, crossVoucher.status);

  // ----------------------------------------------- Audit & notifications ---
  section('11. Audit log and notifications');

  const activity = (await call(accountant, 'GET', `/expenses/${expense.id}/activity`)).data as any;
  const actions: string[] = activity.data.map((entry: any) => entry.action);
  for (const expected of ['expense.created', 'expense.submitted', 'expense.approved', 'payment.recorded', 'accounting.posted']) {
    check(`Audit log records ${expected}`, actions.includes(expected), actions);
  }

  const auditList = (await call(admin, 'GET', '/audit-logs?pageSize=50')).data as any;
  check('Audit log is readable by admin', auditList.data.length > 0);
  const loginAudit = (await call(admin, 'GET', '/audit-logs?action=user.login')).data as any;
  check('Logins are audited', loginAudit.data.length > 0);

  const notifications = (await call(approver, 'GET', '/notifications')).data as any;
  const submitNotice = notifications.data.find((n: any) => n.entityId === expense.id && n.type === 'EXPENSE_SUBMITTED');
  check('Approver was notified of the submission', Boolean(submitNotice), notifications.data.length);

  const accountantNotifications = (await call(accountant, 'GET', '/notifications')).data as any;
  const approvedNotice = accountantNotifications.data.find(
    (n: any) => n.entityId === expense.id && n.type === 'EXPENSE_APPROVED',
  );
  check('Requester was notified of the approval', Boolean(approvedNotice));

  if (submitNotice) {
    const before = notifications.unreadCount;
    await call(approver, 'POST', `/notifications/${submitNotice.id}/read`);
    const after = (await call(approver, 'GET', '/notifications')).data as any;
    check('Marking a notification read lowers the unread count', after.unreadCount === before - 1, {
      before,
      after: after.unreadCount,
    });

    await call(approver, 'POST', '/notifications/read-all');
    const cleared = (await call(approver, 'GET', '/notifications')).data as any;
    check('Mark-all-read clears the badge', cleared.unreadCount === 0, cleared.unreadCount);
  }

  const crossNotification = submitNotice
    ? await call(otherOrg, 'POST', `/notifications/${submitNotice.id}/read`)
    : { status: 404 };
  check('Notifications cannot be read across organizations', crossNotification.status === 404);

  // ----------------------------------------------------- Rejection path ---
  section('12. Rejection path');

  const toReject = (
    await call(accountant, 'POST', '/expenses', {
      date: new Date().toISOString().slice(0, 10),
      title: 'E2E — to be rejected',
      departmentId: gaushala.id,
      fundId: gaushalaFund.id,
      categoryId: feedCategory.id,
      items: [{ description: 'Item', quantity: 1, unit: 'NOS', rate: 1200, taxRate: 0 }],
      payImmediately: false,
    })
  ).data as any;

  await call(accountant, 'POST', `/expenses/${toReject.id}/submit`, {});
  const rejected = await call(approver, 'POST', `/expenses/${toReject.id}/reject`, {
    reason: 'Second quotation required before approval',
  });
  check('Expense is rejected', (rejected.data as any).status === 'REJECTED', rejected.data);
  check('Rejection reason is stored', (rejected.data as any).rejectionReason?.includes('quotation'));

  const fixed = await call(accountant, 'PUT', `/expenses/${toReject.id}`, {
    date: new Date().toISOString().slice(0, 10),
    title: 'E2E — corrected after rejection',
    departmentId: gaushala.id,
    fundId: gaushalaFund.id,
    categoryId: feedCategory.id,
    items: [{ description: 'Item', quantity: 1, unit: 'NOS', rate: 900, taxRate: 0 }],
    payImmediately: false,
  });
  check('Editing a rejected expense returns it to DRAFT', (fixed.data as any).status === 'DRAFT', fixed.data);
  check('Rejection reason is cleared on correction', (fixed.data as any).rejectionStatus === undefined && !(fixed.data as any).rejectionReason);

  // -------------------------------------------------- Donations & banking ---
  section('13. Donations, income and banking');

  const donation = await call(accountant, 'POST', '/donations', {
    date: new Date().toISOString().slice(0, 10),
    donorName: 'E2E Test Donor',
    amount: 5000,
    mode: 'BANK_TRANSFER',
    fundId: gaushalaFund.id,
    bankAccountId: sbi.id,
    purpose: 'Workflow test donation',
    is80GEligible: true,
  });
  check('Donation is recorded with a receipt number', donation.status === 201 && /^DON-/.test((donation.data as any).data.receiptNumber));

  const banking = (await call(accountant, 'GET', '/banking/accounts')).data as any;
  check('Bank balances are computed', banking.status !== 403 && banking.data.length > 0);

  const badTransfer = await call(admin, 'POST', '/banking/transfers', {
    date: new Date().toISOString().slice(0, 10),
    fromAccountId: sbi.id,
    toAccountId: sbi.id,
    amount: 100,
  });
  check('Transfer to the same account is refused (422)', badTransfer.status === 422, badTransfer.status);

  const hdfc = masters.bankAccounts.find((b: any) => b.name.startsWith('HDFC'));
  const hugeTransfer = await call(admin, 'POST', '/banking/transfers', {
    date: new Date().toISOString().slice(0, 10),
    fromAccountId: sbi.id,
    toAccountId: hdfc.id,
    amount: 99_999_999,
  });
  check('Transfer beyond the available balance is refused', hugeTransfer.status === 409, hugeTransfer.status);

  // ------------------------------------------------------------- Donors ---
  section('13b. Donor management');

  const donorList = (await call(accountant, 'GET', '/donors?pageSize=50')).data as any;
  check('Donors are listed with giving stats', donorList.data.length >= 6 && typeof donorList.data[0].stats.totalDonated === 'number', donorList.meta);

  const newDonor = await call(accountant, 'POST', '/donors', {
    name: 'E2E Donor Family',
    category: 'FAMILY',
    phone: '098200 11999',
    email: 'e2e.donor@example.org',
    panNumber: 'abcde1234f',
    district: 'Pune',
    village: 'Hadapsar',
    preferredLanguage: 'mr',
    tags: ['Annadan', 'E2E'],
    whatsappOptIn: true,
  });
  const donorRecord = (newDonor.data as any).data;
  check('Donor is created with an auto code', newDonor.status === 201 && /^DNR-\d{5}$/.test(donorRecord?.code ?? ''), newDonor.data);
  check('PAN is normalised to upper case', donorRecord?.panNumber === 'ABCDE1234F', donorRecord?.panNumber);
  check('Consent time is recorded when opting in', Boolean(donorRecord?.whatsappOptInAt));

  const badDonor = await call(accountant, 'POST', '/donors', { name: 'X', phone: '12', panNumber: 'NOTAPAN' });
  check('Donor validation rejects bad input (422)', badDonor.status === 422, badDonor.status);

  const donorGift = await call(accountant, 'POST', '/donations', {
    date: new Date().toISOString().slice(0, 10),
    donorName: donorRecord.name,
    donorId: donorRecord.id,
    amount: 11_000,
    mode: 'UPI',
    fundId: gaushalaFund.id,
    is80GEligible: true,
  });
  check('A donation can be linked to the donor', donorGift.status === 201, donorGift.data);

  const profile = (await call(accountant, 'GET', `/donors/${donorRecord.id}`)).data as any;
  check('Profile totals include the linked donation', profile.stats?.totalDonated === 11_000 && profile.donations?.length === 1, profile.stats);
  check('Profile reports the donor can be messaged', profile.messaging?.canMessage === true && profile.messaging?.number === '919820011999', profile.messaging);

  const byTag = (await call(accountant, 'GET', '/donors?tag=E2E')).data as any;
  check('Donors filter by tag', byTag.data.length === 1 && byTag.data[0].id === donorRecord.id, byTag.meta);

  const allIds = (await call(accountant, 'GET', '/donors/ids?optIn=yes')).data as any;
  const optedInCount = (await call(accountant, 'GET', '/donors?optIn=yes&pageSize=1')).data as any;
  check('"Select all" returns every matching donor id', allIds.total === optedInCount.meta.total && allIds.total > 1, allIds.total);

  const crossDonor = await call(otherOrg, 'GET', `/donors/${donorRecord.id}`);
  check('Donor profiles are not readable across organizations (404)', crossDonor.status === 404, crossDonor.status);

  const approverDonor = await call(approver, 'POST', '/donors', { name: 'Should Fail' });
  check('Approver cannot add donors (403)', approverDonor.status === 403, approverDonor.status);

  const byPlace = (await call(accountant, 'GET', '/donors?state=&district=pune&village=Hadapsar')).data as any;
  check('Donors filter by district and village', byPlace.data.length === 1 && byPlace.data[0].id === donorRecord.id, byPlace.meta);
  const places = (await call(accountant, 'GET', '/donors/locations?district=Pune')).data as any;
  check(
    'Location options list districts and the villages within one',
    places.data.districts.some((d: any) => d.value === 'Pune') && places.data.villages.some((v: any) => v.value === 'Hadapsar'),
    places.data,
  );

  const withGift = await call(accountant, 'POST', '/donors', {
    name: 'E2E Walk-in Donor',
    state: 'Maharashtra',
    district: 'Satara',
    village: 'Wai',
    donation: { date: new Date().toISOString().slice(0, 10), amount: 2_100, mode: 'CASH', fundId: gaushalaFund.id, is80GEligible: false },
  });
  const withGiftRecord = (withGift.data as any).data;
  check('The donor form records a donation in the same save', withGift.status === 201 && /^DON-/.test(withGiftRecord?.donation?.receiptNumber ?? ''), withGift.data);
  const withGiftProfile = (await call(accountant, 'GET', `/donors/${withGiftRecord?.id}`)).data as any;
  check('That donation is linked to the new donor', withGiftProfile.stats?.totalDonated === 2_100, withGiftProfile.stats);

  const badGift = await call(accountant, 'POST', '/donors', {
    name: 'E2E Rolled Back Donor',
    donation: { date: new Date().toISOString().slice(0, 10), amount: 500, mode: 'CASH', fundId: 'no-such-fund' },
  });
  const rolledBack = (await call(accountant, 'GET', '/donors?search=Rolled%20Back&status=all')).data as any;
  check('A refused donation leaves no half-saved donor', badGift.status === 400 && rolledBack.meta.total === 0, { status: badGift.status, total: rolledBack.meta.total });

  const withAadhaar = await call(accountant, 'POST', '/donors', { name: 'E2E Aadhaar Donor', aadhaarNumber: '2345 6789 0124' });
  const aadhaarDonor = (withAadhaar.data as any).data;
  check(
    'Aadhaar is accepted and only ever returned masked',
    withAadhaar.status === 201 && aadhaarDonor.aadhaarMasked === 'XXXX XXXX 0124' && !JSON.stringify(withAadhaar.data).includes('234567890124'),
    withAadhaar.data,
  );
  const aadhaarList = (await call(accountant, 'GET', '/donors?search=E2E%20Aadhaar')).data as any;
  const aadhaarProfile = (await call(accountant, 'GET', `/donors/${aadhaarDonor.id}`)).data as any;
  check(
    'Lists and profiles never contain the full Aadhaar number',
    !JSON.stringify(aadhaarList).includes('234567890124') && !JSON.stringify(aadhaarProfile).includes('234567890124') && aadhaarProfile.aadhaarMasked === 'XXXX XXXX 0124',
  );
  const badAadhaar = await call(accountant, 'POST', '/donors', { name: 'E2E Bad Aadhaar', aadhaarNumber: '234567890125' });
  check('An Aadhaar number with a wrong check digit is refused (422)', badAadhaar.status === 422, badAadhaar.status);
  const keptAadhaar = ((await call(accountant, 'PUT', `/donors/${aadhaarDonor.id}`, { name: 'E2E Aadhaar Donor', city: undefined })).data as any).data;
  const removedAadhaar = ((await call(accountant, 'PUT', `/donors/${aadhaarDonor.id}`, { name: 'E2E Aadhaar Donor', aadhaarNumber: '' })).data as any).data;
  check(
    'Saving without the field keeps Aadhaar; an empty value removes it',
    keptAadhaar?.aadhaarMasked === 'XXXX XXXX 0124' && removedAadhaar?.aadhaarMasked === null,
    { kept: keptAadhaar?.aadhaarMasked, removed: removedAadhaar?.aadhaarMasked },
  );

  const blocked = await call(admin, 'DELETE', `/donors/${withGiftRecord?.id}/permanent`);
  check('A donor with donations cannot be deleted (409)', blocked.status === 409, blocked.status);
  const disposable = ((await call(accountant, 'POST', '/donors', { name: 'E2E Disposable Donor' })).data as any).data;
  const accountantDelete = await call(accountant, 'DELETE', `/donors/${disposable.id}/permanent`);
  check('Only roles with donor.delete can delete donors (403)', accountantDelete.status === 403, accountantDelete.status);
  const adminDelete = await call(admin, 'DELETE', `/donors/${disposable.id}/permanent`);
  const gone = await call(admin, 'GET', `/donors/${disposable.id}`);
  check('Admin can permanently delete a donor without donations', adminDelete.status === 204 && gone.status === 404, adminDelete.status);

  const mastersForApprover = (await call(approver, 'GET', '/masters')).data as any;
  const leakedPii = mastersForApprover.donors.some((d: any) => 'phone' in d || 'panNumber' in d || 'notes' in d);
  check('Dropdown masters never expose donor contact details or PAN', leakedPii === false);

  const deactivated = await call(accountant, 'DELETE', `/donors/${donorRecord.id}`);
  check('Donors are deactivated, not deleted', deactivated.status === 200 && (deactivated.data as any).data.isActive === false);
  const restored = await call(accountant, 'POST', `/donors/${donorRecord.id}/restore`);
  check('A deactivated donor can be restored', (restored.data as any).data?.isActive === true);

  // ----------------------------------------------------------- WhatsApp ---
  section('13c. WhatsApp messaging guards');

  const waStatus = await call(admin, 'GET', '/whatsapp/status');
  const waData = waStatus.data as any;
  check('WhatsApp status is readable', waStatus.status === 200 && 'cloud' in waData && 'web' in waData, waStatus.data);
  check('Status never returns stored credentials', !JSON.stringify(waData).toLowerCase().includes('token'), Object.keys(waData.cloud));

  const approverWa = await call(approver, 'GET', '/whatsapp/status');
  check('Users without WhatsApp permissions are refused (403)', approverWa.status === 403, approverWa.status);

  const accountantConnect = await call(accountant, 'PUT', '/whatsapp/cloud', {
    phoneNumberId: '123456789',
    businessAccountId: '123456789',
    accessToken: 'x'.repeat(40),
  });
  check('Only managers can connect WhatsApp (403)', accountantConnect.status === 403, accountantConnect.status);

  const badCloud = await call(admin, 'PUT', '/whatsapp/cloud', { phoneNumberId: 'abc', businessAccountId: '1', accessToken: 'short' });
  check('Cloud API credentials are validated before any call to Meta (422)', badCloud.status === 422, badCloud.status);

  if (!EXTERNAL) {
    section('13d. WhatsApp — Connect with Facebook');

    const start = await call(admin, 'GET', '/whatsapp/oauth/start');
    const authUrl = new URL((start.data as any).authUrl ?? 'http://invalid/');
    const state = authUrl.searchParams.get('state') ?? '';
    check(
      'Connect with Facebook sends the admin to Meta with WhatsApp scopes only',
      start.status === 200 &&
        authUrl.searchParams.get('client_id') === META_APP_ID &&
        authUrl.searchParams.get('redirect_uri') === `http://localhost:${TEST_PORT}/api/whatsapp/oauth/callback` &&
        (authUrl.searchParams.get('scope') ?? '').includes('whatsapp_business_messaging') &&
        state.includes('.'),
      start.data,
    );
    const accountantStart = await call(accountant, 'GET', '/whatsapp/oauth/start');
    check('Only WhatsApp managers can start Connect with Facebook (403)', accountantStart.status === 403, accountantStart.status);

    const callback = (query: string) =>
      fetch(`${BASE}/whatsapp/oauth/callback?${query}`, { redirect: 'manual' }).then((response) => new URL(response.headers.get('location') ?? 'http://invalid/'));

    const forged = await callback(`code=e2e-code&state=${encodeURIComponent(state.split('.')[0] + '.forged')}`);
    check('A forged state is refused and nothing is stored', forged.searchParams.get('whatsapp_error') === 'WHATSAPP_OAUTH_EXPIRED', forged.href);

    const denied = await callback(`error=access_denied&state=${encodeURIComponent(state)}`);
    check('Declining on Facebook returns to settings with a reason', denied.pathname === '/settings/whatsapp' && denied.searchParams.get('whatsapp_error') === 'denied', denied.href);

    const landed = await callback(`code=e2e-code&state=${encodeURIComponent(state)}`);
    const pendingId = landed.searchParams.get('whatsapp_pending') ?? '';
    check('The callback exchanges the code and asks which number to use', landed.pathname === '/settings/whatsapp' && Boolean(pendingId), landed.href);
    check(
      'The short-lived token is exchanged for a long-lived one',
      graphCalls.filter((item) => item.path === '/v21.0/oauth/access_token').length >= 2,
      graphCalls.map((item) => item.path),
    );

    const pending = await call(admin, 'GET', `/whatsapp/oauth/pending/${pendingId}`);
    const accounts = (pending.data as any).data?.businessAccounts ?? [];
    check(
      'Only accounts with messaging permission are offered, with their numbers',
      pending.status === 200 && accounts.length === 1 && accounts[0].id === '111111111' && accounts[0].phoneNumbers.length === 2,
      pending.data,
    );
    check('The pending choice never exposes the token', !JSON.stringify(pending.data).includes('e2e-long-lived-token'));

    const crossPending = await call(otherOrg, 'GET', `/whatsapp/oauth/pending/${pendingId}`);
    check('Another organization cannot read or use the pending choice', crossPending.status === 409, crossPending.status);

    const wrongNumber = await call(admin, 'POST', '/whatsapp/oauth/complete', {
      pendingId,
      numbers: [
        { businessAccountId: '111111111', phoneNumberId: '900000001' },
        { businessAccountId: '222222222', phoneNumberId: '900000009' },
      ],
    });
    const nothingConnected = ((await call(admin, 'GET', '/whatsapp/numbers')).data as any).data;
    check(
      'Only numbers Meta listed can be chosen, and a bad pick connects nothing',
      wrongNumber.status === 409 && nothingConnected.length === 0,
      { status: wrongNumber.status, connected: nothingConnected.length },
    );

    const completed = await call(admin, 'POST', '/whatsapp/oauth/complete', {
      pendingId,
      numbers: [
        { businessAccountId: '111111111', phoneNumberId: '900000001' },
        { businessAccountId: '111111111', phoneNumberId: '900000002' },
      ],
    });
    const cloudAfter = (completed.data as any).cloud ?? {};
    const office = (cloudAfter.numbers ?? []).find((item: any) => item.phoneNumberId === '900000002');
    check(
      'Several numbers can be connected through Facebook in one go',
      completed.status === 200 &&
        cloudAfter.status === 'CONNECTED' &&
        cloudAfter.numbers?.length === 2 &&
        cloudAfter.connectMethod === 'OAUTH' &&
        office?.displayNumber === '+91 98200 00002' &&
        office?.qualityRating === 'YELLOW',
      completed.data,
    );
    check('Numbers are listed without their tokens', !JSON.stringify(cloudAfter).includes('e2e-long-lived-token'));
    check('Token expiry is tracked for the reconnect reminder', Boolean(cloudAfter.accessExpiresAt), cloudAfter.accessExpiresAt);
    const subscribed = graphCalls.find((item) => item.method === 'POST' && item.path === '/v21.0/111111111/subscribed_apps');
    check(
      'The business account is subscribed to the webhook with the new token',
      cloudAfter.webhookSubscribed === true && subscribed?.auth === 'Bearer e2e-long-lived-token',
      subscribed,
    );
    const reused = await call(admin, 'GET', `/whatsapp/oauth/pending/${pendingId}`);
    check('A pending choice can be used only once', reused.status === 409, reused.status);

    section('13e. WhatsApp inbox');

    // An unknown person sends a photo to the office number; a donor writes to the main number.
    const strangerPhone = '919876512345';
    const donorPhone = '919820011999';
    const photoStatus = await postWebhook(
      inboundPayload('900000002', strangerPhone, 'Ramesh Kale', { type: 'image', image: { id: 'e2e-inbound-photo', mime_type: 'image/jpeg', caption: 'Seva photo' } }),
    );
    await postWebhook(inboundPayload('900000001', donorPhone, 'E2E Donor', { type: 'text', text: { body: 'Namaskar, receipt please' } }));
    check('Signed inbound webhooks are accepted', photoStatus === 200, photoStatus);

    const inbox = (await call(admin, 'GET', '/whatsapp/conversations')).data as any;
    const stranger = inbox.data?.find((item: any) => item.phone === strangerPhone);
    const donorThread = inbox.data?.find((item: any) => item.phone === donorPhone);
    check(
      'Incoming messages open conversations, newest first, with unread counts',
      inbox.data?.[0]?.phone === donorPhone && stranger?.unreadCount === 1 && donorThread?.unreadCount === 1,
      inbox.data?.map((item: any) => [item.phone, item.unreadCount]),
    );
    check(
      'An unknown sender shows their WhatsApp name; a known number is matched to the donor',
      stranger?.donor === null && stranger?.contactName === 'Ramesh Kale' && donorThread?.donor?.id === donorRecord.id,
      { stranger, donor: donorThread?.donor },
    );
    check('The reply window is open after they write', stranger?.windowOpen === true && Boolean(stranger?.windowExpiresAt));

    const unknownOnly = (await call(admin, 'GET', '/whatsapp/conversations?filter=unknown')).data as any;
    check('The inbox filters unknown contacts', unknownOnly.data?.every((item: any) => item.donor === null) && unknownOnly.data?.length >= 1);

    const badge = (await call(admin, 'GET', '/whatsapp/conversations/unread-count')).data as any;
    check('The unread badge counts unseen messages', badge.count >= 2, badge);

    const thread = (await call(admin, 'GET', `/whatsapp/conversations/${strangerPhone}/messages`)).data as any;
    const photo = thread.data?.[0];
    check('Inbound photos are downloaded from Meta into storage', photo?.mediaType === 'image' && photo?.hasMedia === true && photo?.body === 'Seva photo', photo);
    const photoFile = await fetch(`${BASE}/whatsapp/messages/${photo?.id}/media`, { headers: { Authorization: `Bearer ${admin.token}` } });
    const photoBytes = Buffer.from(await photoFile.arrayBuffer());
    check('The photo is served to staff from our own storage', photoFile.status === 200 && photoBytes.equals(E2E_JPEG), photoFile.status);
    const crossPhoto = await fetch(`${BASE}/whatsapp/messages/${photo?.id}/media`, { headers: { Authorization: `Bearer ${otherOrg.token}` } });
    check('Another organization cannot fetch the photo', crossPhoto.status === 404, crossPhoto.status);

    const accountantInbox = await call(accountant, 'GET', '/whatsapp/conversations');
    check('The inbox needs the WhatsApp inbox permission (403)', accountantInbox.status === 403, accountantInbox.status);

    const reply = await call(admin, 'POST', `/whatsapp/conversations/${strangerPhone}/messages`, { body: 'Thank you {{name}}' });
    const replied = (reply.data as any).data;
    const replyCall = graphCalls.filter((item) => item.method === 'POST' && item.path.endsWith('/messages')).at(-1);
    check(
      'A reply goes out from the number they wrote to, personalised with their name',
      reply.status === 201 && replied?.status === 'SENT' && replied?.body === 'Thank you Ramesh Kale' && replyCall?.path === '/v21.0/900000002/messages',
      { status: reply.status, body: replied?.body, path: replyCall?.path },
    );

    const pdf = new FormData();
    pdf.append('file', new Blob([E2E_PDF], { type: 'application/pdf' }), 'receipt.pdf');
    pdf.append('caption', 'Your receipt');
    const sentPdf = await fetch(`${BASE}/whatsapp/conversations/${donorPhone}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}` },
      body: pdf,
    });
    const sentPdfBody = (await sentPdf.json()) as any;
    check('A PDF can be sent in the conversation', sentPdf.status === 201 && sentPdfBody.data?.mediaType === 'document', sentPdfBody);

    const seen = (await call(admin, 'POST', `/whatsapp/conversations/${strangerPhone}/seen`)).data as any;
    const afterSeen = ((await call(admin, 'GET', '/whatsapp/conversations?filter=unread')).data as any).data;
    check('Opening a conversation marks it read', seen.updated === 1 && !afterSeen.some((item: any) => item.phone === strangerPhone), seen);

    const coldContact = await call(admin, 'POST', '/whatsapp/conversations/919000000001/messages', { body: 'Hello' });
    check('Nobody can be messaged cold from the inbox', coldContact.status === 404 || coldContact.status === 409, coldContact.status);

    const saved = await call(admin, 'POST', '/donors', { name: 'Ramesh Kale', whatsappNumber: '+91 98765 12345', whatsappOptIn: true });
    const savedDonor = (saved.data as any).data;
    const linked = (await call(admin, 'GET', `/whatsapp/conversations/${strangerPhone}`)).data as any;
    check('Saving the contact as a donor attaches the conversation', linked.data?.donor?.id === savedDonor?.id, linked.data?.donor);

    const disconnectOne = await call(admin, 'DELETE', `/whatsapp/numbers/${office?.id}`);
    check(
      'A single number can be disconnected, leaving the other',
      disconnectOne.status === 200 && (disconnectOne.data as any).cloud.numbers.length === 1,
      disconnectOne.status,
    );

    const disconnectAfter = await call(admin, 'DELETE', '/whatsapp/cloud');
    check('The Facebook connection can be disconnected', disconnectAfter.status === 200 && (disconnectAfter.data as any).cloud.status === 'DISCONNECTED', disconnectAfter.status);
  }

  const notConnected = await call(accountant, 'POST', '/whatsapp/send', { donorId: donorRecord.id, body: 'Namaskar {{name}}' });
  check(
    'Sending without a connection gives a clear, translatable error',
    notConnected.status === 409 && (notConnected.data as any).error?.code === 'WHATSAPP_NOT_CONNECTED',
    notConnected.data,
  );

  // A valid number without consent: the only thing standing between it and a
  // message is the opt-in, so this is the check that matters.
  const noConsent = (
    await call(accountant, 'POST', '/donors', { name: 'E2E No Consent', phone: '9820011888', whatsappOptIn: false })
  ).data as any;
  const refused = await call(accountant, 'POST', '/whatsapp/send', { donorId: noConsent.data.id, body: 'Hello' });
  check(
    'A donor who has not opted in is never messaged',
    refused.status === 409 && (refused.data as any).error?.code === 'WHATSAPP_NOT_OPTED_IN',
    refused.data,
  );

  const emptyMessage = await call(accountant, 'POST', '/whatsapp/send', { donorId: donorRecord.id });
  check('An empty message is refused (422)', emptyMessage.status === 422, emptyMessage.status);

  const everyDonor = (await call(accountant, 'GET', '/donors/ids?status=all')).data as any;
  const preview = await call(accountant, 'POST', '/whatsapp/broadcasts/preview', {
    donorIds: everyDonor.data,
    body: 'Namaskar {{name}}, you have given {{total_donated}} to {{organization}}.',
  });
  const previewData = preview.data as any;
  check('Broadcast preview counts eligible and skipped donors', preview.status === 200 && previewData.eligible + previewData.skipped.NOT_OPTED_IN + previewData.skipped.NO_NUMBER + previewData.skipped.INACTIVE === previewData.found, previewData);
  check('Broadcast preview personalises the sample', typeof previewData.sample?.body === 'string' && !previewData.sample.body.includes('{{'), previewData.sample);

  const foreignIds = (await call(otherOrg, 'GET', '/donors/ids')).data as any;
  const crossPreview = (await call(accountant, 'POST', '/whatsapp/broadcasts/preview', { donorIds: foreignIds.data, body: 'Hi' })).data as any;
  check('Another organization’s donors cannot be targeted', crossPreview.found === 0, crossPreview);

  const broadcastNoConnection = await call(accountant, 'POST', '/whatsapp/broadcasts', {
    name: 'E2E broadcast',
    donorIds: everyDonor.data,
    body: 'Namaskar {{name}}',
  });
  check('A broadcast cannot start without a connection (409)', broadcastNoConnection.status === 409, broadcastNoConnection.data);

  // ---------------------------------------------------- Search & filters ---
  section('14. Search, filters and pagination');

  const searched = (await call(accountant, 'GET', '/expenses?search=Gaushala&pageSize=5')).data as any;
  check('Server-side search returns matches', searched.data.length > 0);
  check('Pagination metadata is returned', typeof searched.meta.totalPages === 'number' && searched.meta.pageSize === 5);

  const filtered = (await call(accountant, 'GET', `/expenses?status=ACCOUNTING_POSTED&departmentId=${gaushala.id}`)).data as any;
  const allMatch = filtered.data.every((row: any) => row.status === 'ACCOUNTING_POSTED' && row.department.id === gaushala.id);
  check('Combined filters are applied server-side', allMatch, filtered.data.length);

  const sorted = (await call(accountant, 'GET', '/expenses?sortBy=total&sortDir=desc&pageSize=5')).data as any;
  const descending = sorted.data.every(
    (row: any, index: number) => index === 0 || sorted.data[index - 1].total >= row.total,
  );
  check('Server-side sorting works', descending);

  // ----------------------------------------------------------- Settings ---
  section('15. Settings and permissions management');

  const settings = await call(admin, 'GET', '/settings');
  check('Admin can read settings', settings.status === 200 && Boolean((settings.data as any).organization));

  const roles = (await call(admin, 'GET', '/roles')).data as any;
  const adminRole = roles.data.find((r: any) => r.key === 'ADMIN');
  check('Roles and their permissions are listed', roles.data.length === 4 && adminRole.permissions.length > 0);

  const lockout = await call(admin, 'PUT', `/roles/${adminRole.id}/permissions`, {
    permissions: ['dashboard.view'],
  });
  check('Admin role cannot drop settings.manage (lockout guard)', lockout.status === 409, lockout.status);

  const approverSettings = await call(approver, 'PUT', '/settings/organization', { name: 'Hijacked' });
  check('Approver cannot change organization settings (403)', approverSettings.status === 403, approverSettings.status);

  const backup = await call(admin, 'GET', '/settings/backup');
  check('Backup export succeeds', backup.status === 200);

  // ----------------------------------------------------------- Logout ---
  section('16. Session lifecycle');

  const logout = await call(accountant, 'POST', '/auth/logout');
  check('Logout succeeds', logout.status === 200);

  const afterLogout = await call(accountant, 'GET', '/expenses');
  check('The revoked session no longer works', afterLogout.status === 401, afterLogout.status);

  // ------------------------------------------------------------ Summary ---
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  \x1b[32m${passed} passed\x1b[0m   ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : '0 failed'}`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const failure of failures) console.log(`   • ${failure}`);
  }
  console.log(`${'─'.repeat(60)}\n`);

  stopApi();
  process.exit(failed > 0 ? 1 : 0);
}

process.on('SIGINT', () => {
  stopApi();
  process.exit(130);
});

main().catch((error) => {
  console.error('\nE2E run crashed:', error);
  stopApi();
  process.exit(1);
});
