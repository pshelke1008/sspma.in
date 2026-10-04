/**
 * Browser-driven workflow test.
 *
 * Clicks through the real interface the way a user would — Accountant raises an
 * expense through the four-step wizard, an Approver approves it, the Accountant
 * records payment, and the accounting entry and exports are verified.
 *
 *   npm run qa:workflow
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const WEB = process.env.QA_WEB_URL ?? 'http://localhost:5173';
const PASSWORD = 'Ashram@2026';
const SHOTS = path.resolve(__dirname, 'screenshots', 'workflow');

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    if (detail !== undefined) console.log(`      ${String(detail).slice(0, 300)}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function signIn(page: Page, email: string, landOn = '/dashboard') {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.fill('#identifier', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');

  // After signing in the app returns the user to the page they were on, so
  // wait for any authenticated route, then go where this step needs to be.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25_000 });
  if (!page.url().includes(landOn)) {
    await page.goto(`${WEB}${landOn}`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(400);
}

async function signOut(page: Page) {
  await page.click('button[aria-label="Open user menu"]');
  const signOutItem = page.getByRole('menuitem', { name: /sign out/i });
  await signOutItem.waitFor({ timeout: 10_000 });
  await signOutItem.click();
  await page.waitForURL(/\/login/, { timeout: 25_000 });
  await page.waitForTimeout(300);
}

/**
 * Radix selects render their options in a portal, so pick by role. The label
 * match ignores case: accessible names follow the translation catalog's
 * capitalisation, which the test should not be coupled to.
 */
async function chooseOption(page: Page, triggerLabel: string, optionText: string) {
  await page.click(`[aria-label="${triggerLabel}" i]`);
  await page.getByRole('option', { name: optionText, exact: false }).first().click();
  await page.waitForTimeout(150);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log(`\n\x1b[1mAshram Management — interface workflow\x1b[0m`);
  console.log(`Web: ${WEB}\n`);

  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Download the React DevTools')) {
      consoleErrors.push(message.text());
    }
  });

  const uniqueTitle = `UI Workflow Fodder ${Date.now().toString().slice(-6)}`;

  // ------------------------------------------------- Accountant creates ---
  section('1. Accountant raises an expense through the wizard');

  await signIn(page, 'accounts@ashram.org');
  check('Accountant reaches the dashboard', page.url().includes('/dashboard'), page.url());

  // Use the dashboard quick action rather than typing a URL.
  await page.getByRole('button', { name: 'Add Expense' }).first().click();
  await page.waitForURL(/\/expenses\/new/, { timeout: 15_000 });
  check('Quick action opens the expense wizard', page.url().includes('/expenses/new'));

  // Step 1 — Basic Info
  await page.fill('#title', uniqueTitle);
  await chooseOption(page, 'Department', 'Gaushala');
  await chooseOption(page, 'Fund', 'Gaushala Fund');
  await chooseOption(page, 'Cost center', 'Cow Shed 1');
  await chooseOption(page, 'Expense category', 'Cattle Feed');
  await chooseOption(page, 'Supplier', 'ABC Fodder Supplier');
  await shot(page, '01-step-basic-info');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(400);
  check('Step 1 validates and advances to Items', await page.isVisible('text=Add Item'));

  // Step 2 — Items
  await page.fill('[aria-label="Item 1 description"]', 'Green Fodder');
  await page.fill('[aria-label="Item 1 quantity"]', '500');
  await page.fill('[aria-label="Item 1 rate"]', '8');

  await page.getByRole('button', { name: 'Add Item' }).click();
  await page.waitForTimeout(200);
  await page.fill('[aria-label="Item 2 description"]', 'Dry Fodder');
  await page.fill('[aria-label="Item 2 quantity"]', '300');
  await page.fill('[aria-label="Item 2 rate"]', '10');
  await page.waitForTimeout(400);

  const totalText = await page.textContent('text=/Total/');
  const bodyAfterItems = await page.innerText('body');
  check('Line totals recompute live to ₹7,000', bodyAfterItems.includes('7,000.00'), totalText);
  await shot(page, '02-step-items');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(400);
  check('Step 2 advances to Payment', await page.isVisible('text=Payment status'));
  await shot(page, '03-step-payment');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(400);
  check('Step 3 advances to Review', await page.isVisible('text=Basic Information'));

  const reviewText = await page.innerText('body');
  check('Review shows the entered title', reviewText.includes(uniqueTitle));
  check('Review shows both line items', reviewText.includes('Green Fodder') && reviewText.includes('Dry Fodder'));
  await shot(page, '04-step-review');

  // Step 4 — Submit
  await page.getByRole('button', { name: 'Submit for Approval' }).click();
  // Match the generated id specifically — "/expenses/new" would satisfy a
  // looser pattern and the id would be captured before navigation finished.
  await page.waitForURL((url) => /^\/expenses\/[a-z0-9]{12,}$/i.test(url.pathname), { timeout: 20_000 });
  const expenseId = page.url().split('/').pop() ?? '';
  check('Submitting navigates to the expense detail page', /^[a-z0-9]{12,}$/i.test(expenseId), expenseId);

  await page.waitForTimeout(600);
  const detailText = await page.innerText('body');
  check('Expense is Pending Approval', detailText.includes('Pending Approval'), detailText.slice(0, 200));
  check('Amount reads ₹7,000.00', detailText.includes('7,000.00'));
  await shot(page, '05-expense-detail-pending');

  // The author must not be offered approval controls.
  const approveVisibleToAuthor = await page.getByRole('button', { name: 'Approve' }).isVisible().catch(() => false);
  check('Author is not offered an Approve button', approveVisibleToAuthor === false);

  await signOut(page);

  // ------------------------------------------------------ Approver acts ---
  section('2. Approver reviews and approves');

  await signIn(page, 'approver@ashram.org');

  await page.getByRole('link', { name: /Approvals/ }).first().click();
  await page.waitForURL(/\/approvals/, { timeout: 15_000 });
  await page.waitForTimeout(800);

  const approvalsText = await page.innerText('body');
  check('The submitted expense appears in the approval queue', approvalsText.includes(uniqueTitle));
  check('Budget headroom is shown on the card', approvalsText.includes('budget remaining'));
  await shot(page, '06-approvals-queue');

  // Reject first, to prove the reason is enforced, then re-submit is not
  // needed — instead approve this one and check the reason guard separately.
  const card = page.locator('article').filter({ hasText: uniqueTitle }).first();
  await card.getByRole('button', { name: 'Approve' }).click();
  await page.waitForTimeout(500);

  const confirmText = await page.innerText('body');
  check('Approval asks for confirmation first', confirmText.includes('Approve this expense?'));
  await shot(page, '07-approve-confirm');

  // Scope to the confirmation dialog: the queue cards carry an "Approve"
  // button too, so an unscoped match is ambiguous.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve', exact: true }).click();

  // Confirm via the toast rather than the absence of the title — the success
  // toast itself repeats the expense name.
  const approvedToast = await page
    .getByText('Expense approved', { exact: false })
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  check('Approval confirms with a success toast', approvedToast);

  await page.waitForTimeout(1500);
  const pendingList = page.locator('article').filter({ hasText: uniqueTitle });
  check('Expense leaves the pending queue', (await pendingList.count()) === 0, await pendingList.count());

  await signOut(page);

  // ----------------------------------------------------- Payment & books ---
  section('3. Accountant records payment');

  await signIn(page, 'accounts@ashram.org', '/dashboard');
  await page.goto(`${WEB}/expenses/${expenseId}`, { waitUntil: 'networkidle' });

  // The detail query starts after the shell loads, so wait for the record to
  // appear rather than guessing at a delay.
  await page.getByRole('heading', { name: /Expense EXP-/ }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Record Payment', exact: true }).first().waitFor({ timeout: 20_000 });

  const approvedText = await page.innerText('body');
  check('Expense now reads Approved', approvedText.includes('Approved'));

  await page.getByRole('button', { name: 'Record Payment', exact: true }).first().click();
  await page.waitForTimeout(700);
  check('Payment dialog opens', await page.isVisible('text=Outstanding'));

  await chooseOption(page, 'Payment method', 'Bank Transfer');
  await chooseOption(page, 'Payment account', 'SBI Bank');
  await page.fill('#pay-reference', 'UI-NEFT-2026');
  await shot(page, '08-record-payment');

  await page.getByRole('dialog').getByRole('button', { name: 'Record Payment', exact: true }).click();
  await page
    .getByText('Payment recorded', { exact: false })
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForTimeout(2000);

  const paidText = await page.innerText('body');
  check('Status advances to Accounting Posted', paidText.includes('Accounting Posted'), paidText.slice(0, 200));
  check('Balance due falls to zero', paidText.includes('₹0.00'));
  await shot(page, '09-expense-paid');

  // ----------------------------------------------------------- Tabs ------
  section('4. Expense detail tabs');

  for (const [tab, marker] of [
    ['Items', 'Green Fodder'],
    ['Approval', 'Requested By'],
    ['Payment', 'UI-NEFT-2026'],
    ['Accounting', 'Debit'],
    ['Activity Log', 'Created'],
  ] as const) {
    await page.getByRole('tab', { name: new RegExp(tab, 'i') }).click();
    await page.waitForTimeout(500);
    // innerText reflects CSS text-transform, so compare case-insensitively.
    const text = (await page.innerText('body')).toLowerCase();
    check(`${tab} tab renders its content`, text.includes(marker.toLowerCase()), text.slice(0, 160));
    if (tab === 'Accounting') await shot(page, '10-accounting-tab');
    if (tab === 'Activity Log') await shot(page, '11-activity-log');
  }

  await page.getByRole('tab', { name: /Accounting/i }).click();
  await page.waitForTimeout(400);
  const ledgerText = await page.innerText('body');
  check('Journal shows a balanced ₹7,000 entry', (ledgerText.match(/7,000\.00/g) ?? []).length >= 2);

  // -------------------------------------------------------- Reports -------
  section('5. Reports and exports');

  await page.getByRole('link', { name: /Reports/ }).first().click();
  await page.waitForURL(/\/reports$/, { timeout: 15_000 });
  await page.waitForTimeout(600);
  const reportsText = await page.innerText('body');
  check('Reports centre lists the catalog', reportsText.includes('Income & Expense') && reportsText.includes('Trial Balance'));
  await shot(page, '12-reports-centre');

  await page.getByRole('link', { name: /Income & Expense/ }).first().click();
  await page.waitForURL(/income-expense/, { timeout: 15_000 });
  await page.waitForTimeout(1200);
  const reportText = await page.innerText('body');
  check('Income & Expense report renders rows', reportText.includes('Total Income') && reportText.includes('Net Surplus'));
  await shot(page, '13-report-income-expense');

  // Exports must deliver real files.
  for (const [label, extension] of [
    ['Export Excel', '.xlsx'],
    ['Export PDF', '.pdf'],
    ['CSV', '.csv'],
  ] as const) {
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: label, exact: true }).click();
    const download = await downloadPromise.catch(() => null);
    if (!download) {
      check(`${label} produces a download`, false);
      continue;
    }
    const target = path.join(SHOTS, `export${extension}`);
    await download.saveAs(target);
    const size = fs.statSync(target).size;
    check(`${label} downloads ${download.suggestedFilename()} (${size} bytes)`, size > 500);
  }

  // ------------------------------------------------- Filters persist ------
  section('6. Filters, URL state and empty states');

  await page.goto(`${WEB}/expenses`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  await chooseOption(page, 'Filter by status', 'Draft');
  await page.waitForTimeout(900);
  check('Status filter is reflected in the URL', page.url().includes('status=DRAFT'), page.url());

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const afterReload = await page.innerText('body');
  check('Filter survives a page reload', page.url().includes('status=DRAFT') && afterReload.includes('Draft'));
  await shot(page, '14-expenses-filtered');

  // Force an empty result to prove the empty state renders.
  await page.goto(`${WEB}/expenses?search=zzzznothingmatchesthis`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const emptyText = await page.innerText('body');
  check('Empty state appears when nothing matches', emptyText.includes('No results found'), emptyText.slice(0, 160));
  await shot(page, '15-empty-state');

  // ------------------------------------------------------- RBAC in UI ----
  section('7. Interface respects permissions');

  await signOut(page);
  await signIn(page, 'approver@ashram.org');
  await page.waitForTimeout(600);

  const approverNav = await page.innerText('nav');
  check('Approver does not see Settings in navigation', !approverNav.includes('Settings'), approverNav);

  await page.goto(`${WEB}/settings/users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const deniedText = await page.innerText('body');
  check('Approver hitting a forbidden route sees an access message', deniedText.includes('do not have access'));
  await shot(page, '16-access-denied');

  // ------------------------------------------- Admin on behalf of user ---
  section('8. Admin raises an expense for the accountant and approves it');

  await signOut(page);
  await signIn(page, 'admin@ashram.org', '/expenses/new');
  await page.waitForTimeout(600);

  const onBehalfTitle = `UI On Behalf ${Date.now().toString().slice(-6)}`;
  check('Admin is offered the "Raised on behalf of" picker', await page.isVisible('[aria-label="Raised on behalf of"]'));
  await chooseOption(page, 'Raised on behalf of', 'Meera Kulkarni');
  await page.fill('#title', onBehalfTitle);
  await chooseOption(page, 'Department', 'Gurukul');
  await chooseOption(page, 'Fund', 'Gurukul Fund');
  await chooseOption(page, 'Expense category', 'Repair & Maintenance');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(400);
  await page.fill('[aria-label="Item 1 description"]', 'Blackboard repair');
  await page.fill('[aria-label="Item 1 quantity"]', '1');
  await page.fill('[aria-label="Item 1 rate"]', '2500');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(500);
  const onBehalfReview = await page.innerText('body');
  check('Review names the person the expense is for', onBehalfReview.includes('Meera Kulkarni'));
  await shot(page, '17-on-behalf-review');

  await page.getByRole('button', { name: 'Submit & Approve' }).click();
  await page.waitForURL((url) => /^\/expenses\/[a-z0-9]{12,}$/i.test(url.pathname), { timeout: 20_000 });
  await page.getByRole('heading', { name: /Expense EXP-/ }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const onBehalfDetail = await page.innerText('body');
  check('Submit & Approve lands on an approved expense', onBehalfDetail.includes('Approved'), onBehalfDetail.slice(0, 200));
  check('Detail shows who it was raised for', onBehalfDetail.includes('Meera Kulkarni'));
  await shot(page, '18-on-behalf-approved');

  // ------------------------------------------------------------ Donors ---
  section('9. Donor management');

  await page.getByRole('link', { name: 'Donors' }).first().click();
  await page.waitForURL(/\/donors/, { timeout: 15_000 });
  await page.waitForTimeout(900);
  const donorsText = await page.innerText('body');
  check('Donors page lists seeded donors with totals', donorsText.includes('DNR-00001') && donorsText.includes('₹'));
  await shot(page, '19-donors-list');

  const donorName = `UI Donor ${Date.now().toString().slice(-5)}`;
  await page.getByRole('button', { name: 'Add Donor' }).first().click();
  await page.fill('#donor-name', donorName);
  await page.fill('#donor-phone', '98200 55' + Date.now().toString().slice(-3));
  await page.fill('#donor-city', 'Nashik');
  await page.fill('#donor-tags', 'Annadan,');
  await page.getByRole('dialog').getByRole('checkbox').first().click();
  await shot(page, '20-donor-form');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Donor', exact: true }).click();
  await page.waitForURL((url) => /^\/donors\/[a-z0-9]{12,}$/i.test(url.pathname), { timeout: 20_000 });
  await page.getByRole('heading', { name: donorName }).waitFor({ timeout: 15_000 });
  check('Saving a donor opens their profile', page.url().includes('/donors/'));

  await page.getByRole('button', { name: 'Record Donation' }).first().click();
  await page.fill('#don-amount', '5100');
  await chooseOption(page, 'Fund', 'Gurukul Fund');
  await page.getByRole('dialog').getByRole('button', { name: 'Record Donation', exact: true }).click();
  await page.getByText('Donation recorded', { exact: false }).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  const profileText = await page.innerText('body');
  check('The donation appears on the donor profile', profileText.includes('5,100'), profileText.slice(0, 300));
  await shot(page, '21-donor-profile');

  await page.getByRole('button', { name: 'Send WhatsApp' }).first().click();
  await page.waitForTimeout(800);
  const sendDialog = await page.getByRole('dialog').innerText();
  check('Sending without a connection explains how to connect', sendDialog.includes('WhatsApp is not connected'), sendDialog);
  await page.keyboard.press('Escape');

  // ----------------------------------------------------- Bulk messaging ---
  section('10. Select all donors and prepare a broadcast');

  await page.goto(`${WEB}/donors`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('checkbox', { name: 'Select all donors on this page' }).first().click();
  await page.waitForTimeout(300);
  const selectionText = await page.innerText('body');
  check('Selecting the page shows the selection bar', /\d+ donors selected/.test(selectionText));
  await page.getByRole('button', { name: 'Send WhatsApp' }).first().click();
  await page.waitForTimeout(800);
  const broadcastDialog = await page.getByRole('dialog').innerText();
  check('Broadcast dialog opens for the selected donors', broadcastDialog.includes('WhatsApp Broadcast'), broadcastDialog);
  await shot(page, '22-broadcast-dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'WhatsApp Broadcasts' }).click();
  await page.waitForTimeout(600);
  check('Broadcast history tab renders', (await page.innerText('body')).includes('No broadcasts yet'));

  // ---------------------------------------------------- WhatsApp setup ---
  section('11. WhatsApp connection settings');

  await page.goto(`${WEB}/settings/whatsapp`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const waText = await page.innerText('body');
  check('Both connection methods are offered', waText.includes('WhatsApp Cloud API') && waText.includes('Linked phone (QR code)'));
  const showQr = page.getByRole('button', { name: 'Show QR Code' });
  check('QR linking stays disabled until the risk is acknowledged', await showQr.isDisabled());
  await shot(page, '23-whatsapp-settings');

  // ---------------------------------------------------------- Language ---
  section('12. Marathi and English');

  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'मराठी' }).first().click();
  await page.waitForTimeout(1000);
  const marathiNav = await page.innerText('nav');
  check('Switching to Marathi translates the navigation', marathiNav.includes('देणगीदार') && marathiNav.includes('डॅशबोर्ड'), marathiNav);
  check('The page language is set for screen readers', (await page.evaluate(() => document.documentElement.lang)) === 'mr');
  await shot(page, '24-dashboard-marathi');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('The language choice survives a reload', (await page.innerText('nav')).includes('देणगीदार'));

  await page.getByRole('button', { name: 'English' }).first().click();
  await page.waitForTimeout(1000);
  check('Switching back restores English', (await page.innerText('nav')).includes('Donors'));

  // -------------------------------------------------------- Summary -------
  check('No console errors during the whole run', consoleErrors.length === 0, consoleErrors[0]);

  await browser.close();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  \x1b[32m${passed} passed\x1b[0m   ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : '0 failed'}`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const failure of failures) console.log(`   • ${failure}`);
  }
  console.log(`${'─'.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('UI workflow crashed:', error);
  process.exit(1);
});
