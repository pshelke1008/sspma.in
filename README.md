# Ashram Management

**Service • Education • Compassion**

Finance, donor and administration management for ashrams, gurukuls and
charitable organizations, in **English and मराठी**. It covers the full money
trail — an expense is raised, submitted, approved, paid, posted to a
double-entry ledger, and then reported on, with every step recorded in an audit
log — plus donor profiles with their complete giving history and WhatsApp
messaging to donors who have agreed to receive it.

---

## Quick start

```bash
# 1. Requirements: Node 20+, PostgreSQL 14+
createdb ashram_management

# 2. Configure
cp .env.example .env          # adjust DATABASE_URL and SESSION_SECRET
                              # for WhatsApp: WHATSAPP_ENCRYPTION_KEY=$(openssl rand -base64 32)

# 3. Install, migrate, seed
npm install
npm run setup                 # prisma generate + migrate deploy + seed

# 4. Run
npm run dev                   # API on :4300, web on :5173
```

Open <http://localhost:5173>.

### Sign-in accounts

Password for all seeded accounts: `Ashram@2026`

| Email | Role | What they can do |
| --- | --- | --- |
| `admin@ashram.org` | Admin User | Everything, including users, roles, settings and WhatsApp setup. Can raise expenses on behalf of other users and approve any expense, including their own |
| `finance@ashram.org` | Finance Manager | Raise, approve and pay; donors and WhatsApp messages; reports; view users |
| `accounts@ashram.org` | Accountant | Raise and pay expenses, donations, donors and WhatsApp messages, reports |
| `approver@ashram.org` | Approver | Approve or reject; read-only elsewhere |

A second organization, **Sadhana Kendra** (`admin@sadhanakendra.org`), is seeded
so tenant isolation can be exercised for real — its data must never be reachable
from an Ashram Management session.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web together |
| `npm run build` | Production build of both |
| `npm run setup` | Generate client, apply migrations, seed |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm test` | Unit tests (state machine, separation of duties, money, dates, WhatsApp) |
| `npm run test:e2e` | API workflow suite — reseeds and runs its own API |
| `npm run qa` | Every route at 7 viewports in a real browser, plus a Marathi pass |
| `npm run qa:workflow` | Clicks the whole workflow through the interface |
| `npm run typecheck` | TypeScript across both apps |

The browser suites need a running web server (`npm run dev`) and Playwright's
Chromium (`npx playwright install chromium`).

---

## Architecture

```
apps/
  api/                    Node.js + Express + Prisma
    src/
      lib/                money, dates, accounting, storage, audit, notifications
      middleware/         auth (RBAC + tenancy), validation, errors, rate limits
      modules/            one folder per domain: routes / service / schema
  web/                    React + Vite + TypeScript + Tailwind
    src/
      components/         ui primitives, layout, charts, shared building blocks
      features/           one folder per screen area
      lib/                api client, auth, permissions, formatting
packages/
  types/                  permissions, workflow states and labels shared by both
database/
  schema/                 Prisma schema and migrations
  seed/                   realistic seed data for two organizations
tests/                    browser-driven QA and workflow suites
```

Business rules live in the service layer, not in routes or components. The
`packages/types` package is the single source of truth for permission keys and
the expense state machine, so the client and server can never disagree about
what a status means or which permission guards an action.

---

## The financial workflow

```
Draft → Submitted → Pending Approval → Approved → Payment Pending → Paid → Accounting Posted
                          ↓
                      Rejected → Draft
```

Transitions are declared once in `packages/types` and enforced in
`apps/api/src/modules/expenses/expense.workflow.ts`. Anything not declared is
refused — a paid expense can never return to draft, an expense cannot skip
approval on its way to payment, and nobody decides on their own request unless
their role holds `expense.approve_own`.

**Raising on behalf of someone.** A user with `expense.create_on_behalf` (the
Admin role by default) can key in an expense for another member — the wizard
shows a *Raised on behalf of* picker. The expense records both people, and that
person is notified. For approval purposes *both* count as owners, so the
separation-of-duties rule cannot be sidestepped by raising a request for a
colleague and approving it. The Admin role also holds `expense.approve_own`, so
an admin can use **Submit & Approve** in one step; every other role cannot.

**Approved records are never edited in place.** Reopening an approved or posted
expense reverses its journal voucher and opens a numbered revision that goes
back through approval, so the ledger always reconciles and history stays intact.

Recording the final payment posts a balanced double-entry voucher — debit the
category's expense ledger, credit the account the money actually left — and the
expense moves to `Accounting Posted`.

---

## Donors

**Donors** (sidebar) keeps a profile per donor — category, mobile and WhatsApp
numbers, email, PAN for 80G receipts, address, birthday and anniversary,
preferred language, tags and notes — with an auto-assigned `DNR-00001` code.

- The **profile** shows total given, number of donations, average and last gift,
  every donation (fund, receipt, mode, account), giving by year and by fund, and
  the WhatsApp conversation with that donor. A donation can be recorded straight
  from the profile.
- The **list** filters by category, tag, WhatsApp consent and status, sorts by
  total given or most recent gift, and supports **select all** — across every
  page of the current filter, not just the visible one — to send a WhatsApp
  broadcast.
- Donors are deactivated, never deleted, so receipts stay attributable.
- Donor contact details and PAN are only returned to users with `donor.view`;
  the shared dropdown data carries just id, code and name.

## WhatsApp

**Settings → WhatsApp** connects either or both of two channels, following the
CAThrives integration:

| | WhatsApp Cloud API | Linked phone (QR code) |
| --- | --- | --- |
| How | Meta's official API: phone number ID, business account ID, access token | Scan a QR code with WhatsApp on a phone, like WhatsApp Web (Baileys) |
| Best for | Regular broadcasts at scale | Getting started without Meta approval |
| Limits | Free text only within 24h of the donor's last message; otherwise approved templates | Paced a few seconds apart and capped at `WHATSAPP_MONTHLY_LIMIT` per month |
| Receipts & replies | Webhook at `/api/webhooks/whatsapp` (signed with `WHATSAPP_APP_SECRET`) | Arrive over the linked session |

- **Consent is enforced on the server.** Only active donors with a valid number
  who have opted in are messaged; a broadcast shows who will be skipped before
  it is sent, and records the skipped ones with the reason.
- Messages can be personalised with the donor's name, total given, last
  donation date and the ashram name, filled in per donor at send time.
- Broadcasts run in the background, can be stopped, and resume after a restart.
- Access tokens and linked-device sessions are stored **AES-256-GCM encrypted**
  with `WHATSAPP_ENCRYPTION_KEY`; nothing can be connected until it is set, and
  neither is ever returned to the browser.
- Linking a personal number is against WhatsApp's terms and the number can be
  banned. The screen says so and requires acknowledgement; use a dedicated
  ashram number. QR sessions live in the API process, so run a single API
  instance while that channel is in use.

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_ENCRYPTION_KEY` | Required. `openssl rand -base64 32` |
| `WHATSAPP_WEB_ENABLED` | `false` turns QR linking off entirely |
| `WHATSAPP_MONTHLY_LIMIT` | Monthly cap for the linked phone (default 250) |
| `WHATSAPP_GRAPH_VERSION` | Meta Graph API version (default `v21.0`) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Cloud API delivery receipts and replies |

## Languages

The whole interface is available in **English and मराठी** — switch from the
header (or the menu on a phone, or *My Profile*). The choice is saved to the
user's profile and follows them to other devices. Reports, PDF/Excel/CSV
exports and expense vouchers are produced in the same language; PDFs embed the
Mukta typeface (SIL Open Font License, `apps/api/assets/fonts`) so Devanagari
and Latin text render correctly. Dates use Marathi month names with Western
digits (`17 सप्टें. 2026`), so amounts and dates read the same in both languages.

Status names, payment methods and report titles live in
`packages/types/src/i18n.ts` so a screen and its export always use the same
word; screen text lives in `apps/web/src/i18n/locales`.

---

## Security

- **Sessions** are random 48-byte tokens; only an HMAC of each token is stored.
  They are delivered as `httpOnly`, `sameSite=lax` cookies and can be revoked.
- **Passwords** are bcrypt hashed. A failed sign-in runs the same hash
  comparison as a successful one so timing cannot reveal whether an account
  exists, and never says which half of the credentials was wrong.
- **Authorization is server-side.** Every protected route passes through
  `requirePermission(...)`. The interface hides controls a user cannot use, but
  hiding a button is never the control.
- **Tenant isolation** is enforced in the service layer: `organizationId` always
  comes from the session, never from the request body, and every query is scoped
  by it. Cross-tenant reads return 404 rather than 403, so ids cannot be probed.
- **Uploads** are re-validated on the server for MIME type, extension, size and
  magic bytes. Object keys are namespaced per organization and carry a random
  component.
- **Rate limits** protect sign-in and the wider API surface.
- **Totals are always recomputed server-side** from quantity, rate and tax. A
  tampered client payload cannot change what the ledger records.

---

## Testing

| Suite | Coverage |
| --- | --- |
| `npm test` | 42 unit tests: state machine, transition permissions, separation of duties, edit/delete guards, line arithmetic, financial-year maths, phone normalisation, secret encryption, WhatsApp error codes |
| `npm run test:e2e` | 157 checks: auth, RBAC, tenant isolation, the whole expense lifecycle, admin on-behalf entry and self-approval, revisions, all 14 reports, PDF/Excel/CSV exports in English and Marathi, audit log, notifications, banking, donors, WhatsApp consent and permission guards, settings |
| `npm run qa` | Every route at 1440/1280/1024/768/430/390/375, and again in Marathi at desktop and phone width — console errors, 5xx responses, horizontal overflow, forbidden wording, WCAG 2.1 AA (axe) |
| `npm run qa:workflow` | 55 checks driving the real interface: the four-step wizard, approval, payment, all detail tabs, real file downloads, filter persistence, empty states, permission gating, admin Submit & Approve on behalf of a user, donors, broadcasts, WhatsApp settings, language switching |

`test:e2e` reseeds the database and starts its own API process, so it is
repeatable. Point `E2E_API_URL` at a deployment to test it instead, and the
database is left alone.

---

## Storage

Attachments go to an S3-compatible bucket. `STORAGE_DRIVER=local` (the default)
writes to `./storage` so the app runs with no cloud credentials; set
`STORAGE_DRIVER=s3` with the `S3_*` variables for MinIO, S3 or any compatible
service. Credentials stay on the server.

---

## Reports

Fourteen reports, each backed by live ledger data and exportable to PDF, Excel
and CSV with the filters you applied:

**Financial** — Income & Expense, Balance Sheet, Trial Balance, General Ledger,
Cash Flow, Cash Book
**Management** — Fund Report, Department P&L, Budget vs Actual, Expense Analysis
**Donations** — Donor Report, Donation Summary
**Payables** — Supplier Outstanding, Payment Report

Adding one means adding a case to `report.service.ts` that returns columns, rows
and a summary; the viewer, the three exporters and the filter bar are generic.
