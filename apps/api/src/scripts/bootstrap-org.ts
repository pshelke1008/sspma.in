/**
 * Creates a real organization and its first users on an empty production
 * database. The production counterpart of database/seed/seed.ts, without any
 * of its demo data.
 *
 * Reads a JSON spec on stdin (see deploy/bootstrap.example.json) and prints
 * each new user's password ONCE. Run inside the API image, so it uses the
 * deployed Prisma client and the container's DATABASE_URL:
 *
 *   docker compose --env-file deploy/prod.env -f deploy/compose.yaml \
 *     run --rm -T --no-deps --label traefik.enable=false \
 *     api node apps/api/dist/scripts/bootstrap-org.js < bootstrap.json
 *
 * Add --dry-run to the end of that command first. It performs every write
 * inside the transaction and then rolls it back, so it proves the spec against
 * the real schema, constraints and data without leaving anything behind.
 *
 * Safe to re-run. Everything is matched on a natural key (permission key,
 * organization slug, role key, account code, user email), so a second run adds
 * only what is missing. An existing user is never touched — in particular, its
 * password is never reset.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type RoleKey,
} from '@ashram/types';
import { SYSTEM_ACCOUNTS } from '../lib/accounting';

const roleKeys = Object.keys(ROLE_PERMISSIONS) as [RoleKey, ...RoleKey[]];

/** A blank string in the JSON means "not provided", not "provided as empty". */
const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

const accountSchema = z.object({
  code: z.string().regex(/^\d{4}$/, 'Account codes are four digits'),
  name: z.string().trim().min(1),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  isBankAccount: z.boolean().default(false),
});

const specSchema = z.object({
  organization: z.object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Lowercase letters, digits and hyphens'),
    name: z.string().trim().min(1),
    legalName: blank(z.string().trim()),
    registrationNo: blank(z.string().trim()),
    panNumber: blank(z.string().trim()),
    email: blank(z.string().trim().toLowerCase().email()),
    phone: blank(z.string().trim()),
    website: blank(z.string().trim().url()),
    addressLine1: blank(z.string().trim()),
    addressLine2: blank(z.string().trim()),
    city: blank(z.string().trim()),
    state: blank(z.string().trim()),
    postalCode: blank(z.string().trim()),
    tagline: blank(z.string().trim()),
  }),
  users: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        // Lower-cased like users.routes.ts does, because login lower-cases
        // what is typed and compares exactly.
        email: z.string().trim().toLowerCase().email(),
        role: z.enum(roleKeys),
        mobile: blank(z.string().trim()),
        designation: blank(z.string().trim()),
      }),
    )
    .min(1)
    .refine((users) => users.some((u) => u.role === 'ADMIN'), 'At least one user must be ADMIN')
    .refine((users) => new Set(users.map((u) => u.email)).size === users.length, 'Duplicate email'),
  /** Accounts beyond the default chart below — funds, extra banks, expense heads. */
  extraAccounts: z.array(accountSchema).default([]),
});

type Spec = z.infer<typeof specSchema>;
type AccountSpec = z.input<typeof accountSchema>;

/**
 * The minimum chart a new organization can work with. Every code in
 * SYSTEM_ACCOUNTS must be here: the donation and payment paths look them up by
 * code and, when one is missing, skip the journal entry WITHOUT an error — the
 * donation saves and the ledger silently disagrees with it. Checked below
 * rather than trusted.
 *
 * Opening balances are all zero; the organization enters its real ones in the
 * app, against 3001 Opening Balance Equity.
 */
const DEFAULT_ACCOUNTS: AccountSpec[] = [
  { code: '1000', name: 'Assets', type: 'ASSET' },
  { code: '1101', name: 'Bank', type: 'ASSET', isBankAccount: true },
  { code: '1103', name: 'Cash in Hand', type: 'ASSET', isBankAccount: true },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY' },
  { code: '2100', name: 'Accounts Payable', type: 'LIABILITY' },
  { code: '3000', name: 'Funds & Reserves', type: 'EQUITY' },
  { code: '3001', name: 'Opening Balance Equity', type: 'EQUITY' },
  { code: '3101', name: 'General Fund', type: 'EQUITY' },
  { code: '4000', name: 'Income', type: 'INCOME' },
  { code: '4101', name: 'Donations', type: 'INCOME' },
  { code: '4102', name: 'Grants', type: 'INCOME' },
  { code: '4199', name: 'Other Income', type: 'INCOME' },
  { code: '5000', name: 'Expenses', type: 'EXPENSE' },
  { code: '5199', name: 'Miscellaneous Expense', type: 'EXPENSE' },
];

const missingSystem = Object.values(SYSTEM_ACCOUNTS).filter(
  (code) => !DEFAULT_ACCOUNTS.some((account) => account.code === code),
);
if (missingSystem.length > 0) {
  throw new Error(`DEFAULT_ACCOUNTS is missing system account(s): ${missingSystem.join(', ')}`);
}

/** 16 characters from 12 random bytes; URL-safe so it survives copy and paste. */
function generatePassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Thrown at the end of a dry run's transaction purely to roll it back. */
class DryRunRollback extends Error {}

async function bootstrap(prisma: PrismaClient, spec: Spec, dryRun: boolean) {
  const created: { name: string; email: string; role: string; password: string }[] = [];
  const skipped: string[] = [];

  // Hashing is slow on purpose, so it happens before the transaction opens
  // rather than holding it while bcrypt runs.
  const passwords = new Map<string, { plain: string; hash: string }>();
  for (const user of spec.users) {
    const plain = generatePassword();
    passwords.set(user.email, { plain, hash: await bcrypt.hash(plain, 10) });
  }

  const accounts = [...DEFAULT_ACCOUNTS, ...spec.extraAccounts];

  await prisma.$transaction(
    async (tx) => {
      // ---- Permission catalog (global, shared by every organization) ----
      const labelByKey = new Map<string, { label: string; group: string }>();
      for (const [group, items] of Object.entries(PERMISSION_GROUPS)) {
        for (const item of items) labelByKey.set(item.key, { label: item.label, group });
      }
      for (const key of PERMISSIONS) {
        const meta = labelByKey.get(key) ?? { label: key, group: 'General' };
        await tx.permission.upsert({
          where: { key },
          create: { key, label: meta.label, group: meta.group },
          update: { label: meta.label, group: meta.group },
        });
      }

      // ---- Organization ----
      // update: {} — a re-run must not overwrite details edited in the app.
      const { slug, ...details } = spec.organization;
      const organization = await tx.organization.upsert({
        where: { slug },
        update: {},
        create: { slug, ...details },
      });
      const organizationId = organization.id;

      // ---- Roles ----
      // Permissions of the built-in roles are re-synced to ROLE_PERMISSIONS,
      // as the seed does, so a re-run after an upgrade picks up new ones.
      const permissionRows = await tx.permission.findMany({ select: { id: true, key: true } });
      const permissionByKey = new Map(permissionRows.map((p) => [p.key, p.id]));
      const roleIdByKey = new Map<string, string>();
      for (const roleKey of roleKeys) {
        const role = await tx.role.upsert({
          where: { organizationId_key: { organizationId, key: roleKey } },
          update: { name: ROLE_LABELS[roleKey] },
          create: {
            organizationId,
            key: roleKey,
            name: ROLE_LABELS[roleKey],
            description: `${ROLE_LABELS[roleKey]} role`,
            isSystem: true,
          },
        });
        roleIdByKey.set(roleKey, role.id);
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({
          data: ROLE_PERMISSIONS[roleKey]
            .map((key) => permissionByKey.get(key))
            .filter((id): id is string => Boolean(id))
            .map((permissionId) => ({ roleId: role.id, permissionId })),
        });
      }

      // ---- Financial year ----
      // April to March, the Indian financial year, labelled like the seed's.
      const now = new Date();
      const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const label = `${startYear}-${startYear + 1}`;
      const existingYears = await tx.financialYear.count({ where: { organizationId } });
      await tx.financialYear.upsert({
        where: { organizationId_label: { organizationId, label } },
        update: {},
        create: {
          organizationId,
          label,
          startDate: new Date(`${startYear}-04-01T00:00:00.000Z`),
          endDate: new Date(`${startYear + 1}-03-31T23:59:59.000Z`),
          // Active only if it is the organization's first; never steals the
          // flag from a year someone activated in the app.
          isActive: existingYears === 0,
        },
      });

      // ---- Chart of accounts ----
      const accountIdByCode = new Map<string, string>();
      for (const account of accounts) {
        const row = await tx.account.upsert({
          where: { organizationId_code: { organizationId, code: account.code } },
          update: {},
          create: {
            organizationId,
            code: account.code,
            name: account.name,
            type: account.type,
            isBankAccount: account.isBankAccount ?? false,
            openingBalance: new Prisma.Decimal(0),
          },
        });
        accountIdByCode.set(account.code, row.id);
      }

      // Cash is the one "bank" every organization has, so it gets its banking
      // record here. Real bank accounts are added in the app with their numbers.
      const cashAccountId = accountIdByCode.get(SYSTEM_ACCOUNTS.CASH_IN_HAND)!;
      const cash = await tx.bankAccount.findFirst({ where: { organizationId, accountId: cashAccountId } });
      if (!cash) {
        await tx.bankAccount.create({
          data: {
            organizationId,
            name: 'Cash in Hand',
            accountType: 'CASH',
            accountId: cashAccountId,
            openingBalance: new Prisma.Decimal(0),
          },
        });
      }

      // ---- Users ----
      for (const user of spec.users) {
        const existing = await tx.user.findUnique({
          where: { organizationId_email: { organizationId, email: user.email } },
          select: { id: true },
        });
        if (existing) {
          skipped.push(user.email);
          continue;
        }
        const password = passwords.get(user.email)!;
        await tx.user.create({
          data: {
            organizationId,
            name: user.name,
            email: user.email,
            mobile: user.mobile ?? null,
            designation: user.designation ?? ROLE_LABELS[user.role],
            roleId: roleIdByKey.get(user.role)!,
            passwordHash: password.hash,
          },
        });
        created.push({ name: user.name, email: user.email, role: user.role, password: password.plain });
      }

      if (dryRun) throw new DryRunRollback();
    },
    { timeout: 60_000 },
  ).catch((error: unknown) => {
    if (!(error instanceof DryRunRollback)) throw error;
  });

  return { created, skipped, accounts: accounts.length };
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')} — only --dry-run is accepted`);
  const dryRun = args.includes('--dry-run');

  const raw = await readStdin();
  if (!raw.trim()) {
    throw new Error('No input. Pipe the JSON spec on stdin — see deploy/bootstrap.example.json');
  }
  const parsed = specSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid spec:\n${issues.join('\n')}`);
  }

  const prisma = new PrismaClient();
  try {
    const spec = parsed.data;
    const { created, skipped, accounts } = await bootstrap(prisma, spec, dryRun);

    if (dryRun) {
      console.log('\nDRY RUN — every write below was made and then rolled back. Nothing was saved.');
      console.log('Run again without --dry-run to create it.');
    }
    console.log(`\nOrganization  ${spec.organization.name} (${spec.organization.slug})`);
    console.log(`Accounts      ${accounts} ensured, roles ${roleKeys.join(', ')}`);
    for (const email of skipped) console.log(`User exists   ${email} — left unchanged`);

    if (created.length > 0 && dryRun) {
      console.log('\nWould create:\n');
      for (const user of created) console.log(`  ${user.role.padEnd(16)} ${user.email.padEnd(36)} ${user.name}`);
      console.log('');
    } else if (created.length > 0) {
      console.log('\nNew users. These passwords are shown ONCE and stored nowhere —');
      console.log('hand each to its owner and have them change it after signing in.\n');
      for (const user of created) {
        console.log(`  ${user.role.padEnd(16)} ${user.email.padEnd(36)} ${user.password}   ${user.name}`);
      }
      console.log('');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
