/**
 * Ashram Management seed.
 *
 * Creates two independent organizations. The second one exists so tenant
 * isolation can be exercised for real: its users and data must never be
 * reachable from the first organization's session.
 */
import path from 'node:path';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type RoleKey,
} from '@ashram/types';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

const dec = (value: number) => new Prisma.Decimal(value.toFixed(2));

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(11, 0, 0, 0);
  return date;
}

async function seedPermissionCatalog() {
  const labelByKey = new Map<string, { label: string; group: string }>();
  for (const [group, items] of Object.entries(PERMISSION_GROUPS)) {
    for (const item of items) labelByKey.set(item.key, { label: item.label, group });
  }

  for (const key of PERMISSIONS) {
    const meta = labelByKey.get(key) ?? { label: key, group: 'General' };
    await prisma.permission.upsert({
      where: { key },
      create: { key, label: meta.label, group: meta.group },
      update: { label: meta.label, group: meta.group },
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions`);
}

interface OrgSpec {
  slug: string;
  name: string;
  legalName: string;
  city: string;
  state: string;
  emailDomain: string;
  rich: boolean;
}

async function seedOrganization(spec: OrgSpec) {
  const organization = await prisma.organization.upsert({
    where: { slug: spec.slug },
    update: {},
    create: {
      slug: spec.slug,
      name: spec.name,
      legalName: spec.legalName,
      registrationNo: `REG/${spec.slug.toUpperCase().slice(0, 6)}/2019`,
      panNumber: 'AAATA1234F',
      email: `office@${spec.emailDomain}`,
      phone: '+91 98200 11223',
      website: `https://${spec.emailDomain}`,
      addressLine1: 'Ashram Marg',
      city: spec.city,
      state: spec.state,
      postalCode: '411045',
      country: 'India',
      currency: 'INR',
      tagline: 'Service • Education • Compassion',
    },
  });
  const organizationId = organization.id;

  // ---- Roles & permissions ----
  const permissionRows = await prisma.permission.findMany();
  const permissionByKey = new Map(permissionRows.map((p) => [p.key, p.id]));
  const roles: Record<string, string> = {};

  for (const roleKey of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
    const role = await prisma.role.upsert({
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
    roles[roleKey] = role.id;

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: ROLE_PERMISSIONS[roleKey]
        .map((key) => permissionByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }

  // ---- Users ----
  const passwordHash = await bcrypt.hash('Ashram@2026', 10);
  const userSpecs = [
    { name: 'Ananya Iyer', email: `admin@${spec.emailDomain}`, role: 'ADMIN', designation: 'Admin User', mobile: '9820011001' },
    { name: 'Rohit Deshpande', email: `finance@${spec.emailDomain}`, role: 'FINANCE_MANAGER', designation: 'Finance Manager', mobile: '9820011002' },
    { name: 'Meera Kulkarni', email: `accounts@${spec.emailDomain}`, role: 'ACCOUNTANT', designation: 'Accountant', mobile: '9820011003' },
    { name: 'Suresh Nair', email: `approver@${spec.emailDomain}`, role: 'APPROVER', designation: 'Approver', mobile: '9820011004' },
  ];

  const users: Record<string, string> = {};
  for (const userSpec of userSpecs) {
    const user = await prisma.user.upsert({
      where: { organizationId_email: { organizationId, email: userSpec.email } },
      update: { name: userSpec.name, roleId: roles[userSpec.role], designation: userSpec.designation },
      create: {
        organizationId,
        name: userSpec.name,
        email: userSpec.email,
        mobile: userSpec.mobile,
        designation: userSpec.designation,
        roleId: roles[userSpec.role],
        passwordHash,
      },
    });
    users[userSpec.role] = user.id;
  }

  // ---- Financial years ----
  const fyStartYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  for (const offset of [0, -1]) {
    const startYear = fyStartYear + offset;
    await prisma.financialYear.upsert({
      where: { organizationId_label: { organizationId, label: `${startYear}-${startYear + 1}` } },
      update: {},
      create: {
        organizationId,
        label: `${startYear}-${startYear + 1}`,
        startDate: new Date(`${startYear}-04-01T00:00:00.000Z`),
        endDate: new Date(`${startYear + 1}-03-31T23:59:59.000Z`),
        isActive: offset === 0,
      },
    });
  }

  // ---- Chart of accounts ----
  const accountSpecs: {
    code: string;
    name: string;
    type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
    isBank?: boolean;
    opening?: number;
  }[] = [
    { code: '1000', name: 'Assets', type: 'ASSET' },
    { code: '1101', name: 'SBI Bank', type: 'ASSET', isBank: true, opening: spec.rich ? 1_200_000 : 220_000 },
    { code: '1102', name: 'HDFC Bank', type: 'ASSET', isBank: true, opening: spec.rich ? 550_000 : 95_000 },
    { code: '1103', name: 'Cash in Hand', type: 'ASSET', isBank: true, opening: spec.rich ? 165_000 : 18_000 },
    { code: '1104', name: 'UPI Wallet', type: 'ASSET', isBank: true, opening: spec.rich ? 100_000 : 12_000 },
    { code: '2000', name: 'Liabilities', type: 'LIABILITY' },
    { code: '2100', name: 'Accounts Payable', type: 'LIABILITY' },
    { code: '3000', name: 'Funds & Reserves', type: 'EQUITY' },
    { code: '3101', name: 'General Fund', type: 'EQUITY' },
    { code: '3102', name: 'Gurukul Fund', type: 'EQUITY' },
    { code: '3103', name: 'Gaushala Fund', type: 'EQUITY' },
    { code: '3104', name: 'Annadan Fund', type: 'EQUITY' },
    { code: '4000', name: 'Income', type: 'INCOME' },
    { code: '4101', name: 'Donations', type: 'INCOME' },
    { code: '4102', name: 'Grants', type: 'INCOME' },
    { code: '4103', name: 'Gurukul Fees', type: 'INCOME' },
    { code: '4199', name: 'Other Income', type: 'INCOME' },
    { code: '5000', name: 'Expenses', type: 'EXPENSE' },
    { code: '5101', name: 'Cattle Feed Expense', type: 'EXPENSE' },
    { code: '5102', name: 'Electricity Expense', type: 'EXPENSE' },
    { code: '5103', name: 'Repairs & Maintenance', type: 'EXPENSE' },
    { code: '5104', name: 'Books & Stationery', type: 'EXPENSE' },
    { code: '5105', name: 'Medical Expense', type: 'EXPENSE' },
    { code: '5106', name: 'Salaries & Honorarium', type: 'EXPENSE' },
    { code: '5107', name: 'Food & Provisions', type: 'EXPENSE' },
    { code: '5108', name: 'Transport & Fuel', type: 'EXPENSE' },
    { code: '5199', name: 'Miscellaneous Expense', type: 'EXPENSE' },
  ];

  // Double entry demands the opening asset balances be matched by opening
  // equity, otherwise the trial balance is out from the very first day.
  const openingAssets = accountSpecs
    .filter((account) => account.isBank)
    .reduce((sum, account) => sum + (account.opening ?? 0), 0);
  accountSpecs.push({
    code: '3001',
    name: 'Opening Balance Equity',
    type: 'EQUITY',
    opening: openingAssets,
  });

  const accounts: Record<string, string> = {};
  for (const account of accountSpecs) {
    const created = await prisma.account.upsert({
      where: { organizationId_code: { organizationId, code: account.code } },
      update: { name: account.name },
      create: {
        organizationId,
        code: account.code,
        name: account.name,
        type: account.type,
        isBankAccount: account.isBank ?? false,
        openingBalance: dec(account.opening ?? 0),
      },
    });
    accounts[account.code] = created.id;
  }

  // ---- Bank accounts ----
  const bankSpecs = [
    { name: 'SBI Bank — Main', accountType: 'BANK' as const, code: '1101', bankName: 'State Bank of India', accountNumber: '32014567890', ifsc: 'SBIN0001234', branch: 'Pune Camp', opening: spec.rich ? 1_200_000 : 220_000 },
    { name: 'HDFC Bank — Projects', accountType: 'BANK' as const, code: '1102', bankName: 'HDFC Bank', accountNumber: '50100234567', ifsc: 'HDFC0000456', branch: 'Aundh', opening: spec.rich ? 550_000 : 95_000 },
    { name: 'Cash in Hand', accountType: 'CASH' as const, code: '1103', opening: spec.rich ? 165_000 : 18_000 },
    { name: 'UPI Wallet', accountType: 'UPI_WALLET' as const, code: '1104', upiId: `${spec.slug}@upi`, opening: spec.rich ? 100_000 : 12_000 },
  ];

  const banks: Record<string, string> = {};
  for (const bank of bankSpecs) {
    const existing = await prisma.bankAccount.findFirst({ where: { organizationId, name: bank.name } });
    const record =
      existing ??
      (await prisma.bankAccount.create({
        data: {
          organizationId,
          name: bank.name,
          accountType: bank.accountType,
          bankName: bank.bankName ?? null,
          accountNumber: bank.accountNumber ?? null,
          ifsc: bank.ifsc ?? null,
          branch: bank.branch ?? null,
          upiId: bank.upiId ?? null,
          accountId: accounts[bank.code],
          openingBalance: dec(bank.opening),
        },
      }));
    banks[bank.name] = record.id;
  }

  // ---- Departments ----
  const departmentSpecs = [
    { name: 'Gurukul', code: 'GUR', budget: spec.rich ? 250_000 : 60_000, color: 'info' },
    { name: 'Gaushala', code: 'GAU', budget: spec.rich ? 180_000 : 40_000, color: 'success' },
    { name: 'Ashram', code: 'ASH', budget: spec.rich ? 220_000 : 50_000, color: 'primary' },
    { name: 'Annadan', code: 'ANN', budget: spec.rich ? 150_000 : 35_000, color: 'warning' },
  ];
  const departments: Record<string, string> = {};
  for (const department of departmentSpecs) {
    const record = await prisma.department.upsert({
      where: { organizationId_code: { organizationId, code: department.code } },
      update: { name: department.name, budgetAmount: dec(department.budget) },
      create: {
        organizationId,
        name: department.name,
        code: department.code,
        budgetAmount: dec(department.budget),
        colorToken: department.color,
      },
    });
    departments[department.name] = record.id;
  }

  // ---- Funds ----
  const fundSpecs = [
    { name: 'General Fund', code: 'GEN', opening: spec.rich ? 750_000 : 120_000 },
    { name: 'Gurukul Fund', code: 'GURF', opening: spec.rich ? 550_000 : 80_000, restricted: true },
    { name: 'Gaushala Fund', code: 'GAUF', opening: spec.rich ? 450_000 : 70_000, restricted: true },
    { name: 'Annadan Fund', code: 'ANNF', opening: spec.rich ? 300_000 : 55_000, restricted: true },
  ];
  const funds: Record<string, string> = {};
  for (const fund of fundSpecs) {
    const record = await prisma.fund.upsert({
      where: { organizationId_code: { organizationId, code: fund.code } },
      update: { name: fund.name },
      create: {
        organizationId,
        name: fund.name,
        code: fund.code,
        openingBalance: dec(fund.opening),
        isRestricted: fund.restricted ?? false,
      },
    });
    funds[fund.name] = record.id;
  }

  // ---- Cost centers ----
  const costCenterSpecs = [
    { name: 'Cow Shed 1', code: 'CC-GAU-1', department: 'Gaushala' },
    { name: 'Cow Shed 2', code: 'CC-GAU-2', department: 'Gaushala' },
    { name: 'Primary Wing', code: 'CC-GUR-1', department: 'Gurukul' },
    { name: 'Secondary Wing', code: 'CC-GUR-2', department: 'Gurukul' },
    { name: 'Main Kitchen', code: 'CC-ANN-1', department: 'Annadan' },
    { name: 'Guest House', code: 'CC-ASH-1', department: 'Ashram' },
    { name: 'Dispensary', code: 'CC-ASH-2', department: 'Ashram' },
  ];
  const costCenters: Record<string, string> = {};
  for (const costCenter of costCenterSpecs) {
    const record = await prisma.costCenter.upsert({
      where: { organizationId_code: { organizationId, code: costCenter.code } },
      update: { name: costCenter.name },
      create: {
        organizationId,
        name: costCenter.name,
        code: costCenter.code,
        departmentId: departments[costCenter.department],
      },
    });
    costCenters[costCenter.name] = record.id;
  }

  // ---- Expense categories ----
  const categorySpecs = [
    { name: 'Cattle Feed', code: 'CAT-FEED', account: '5101' },
    { name: 'Electricity', code: 'CAT-ELEC', account: '5102' },
    { name: 'Repair & Maintenance', code: 'CAT-REPAIR', account: '5103' },
    { name: 'Books & Stationery', code: 'CAT-BOOKS', account: '5104' },
    { name: 'Medical', code: 'CAT-MED', account: '5105' },
    { name: 'Salaries & Honorarium', code: 'CAT-SAL', account: '5106' },
    { name: 'Food & Provisions', code: 'CAT-FOOD', account: '5107' },
    { name: 'Transport & Fuel', code: 'CAT-TRANS', account: '5108' },
    { name: 'Miscellaneous', code: 'CAT-MISC', account: '5199' },
  ];
  const categories: Record<string, string> = {};
  for (const category of categorySpecs) {
    const record = await prisma.expenseCategory.upsert({
      where: { organizationId_code: { organizationId, code: category.code } },
      update: { name: category.name, accountId: accounts[category.account] },
      create: {
        organizationId,
        name: category.name,
        code: category.code,
        accountId: accounts[category.account],
      },
    });
    categories[category.name] = record.id;
  }

  // ---- Suppliers ----
  const supplierSpecs = [
    { name: 'ABC Fodder Supplier', code: 'SUP-ABC', contact: 'Ramesh Patil', phone: '9822001122', city: spec.city },
    { name: 'MSEB Electricity Board', code: 'SUP-MSEB', contact: 'Billing Desk', phone: '18002333435', city: spec.city },
    { name: 'Shree Hardware & Repairs', code: 'SUP-SHR', contact: 'Vikas Jadhav', phone: '9822003344', city: spec.city },
    { name: 'Vidya Book Depot', code: 'SUP-VBD', contact: 'Sneha Joshi', phone: '9822004455', city: spec.city },
    { name: 'Arogya Medical Stores', code: 'SUP-AMS', contact: 'Dr. Kavita Rao', phone: '9822005566', city: spec.city },
    { name: 'Annapurna Provisions', code: 'SUP-ANP', contact: 'Ganesh Shinde', phone: '9822006677', city: spec.city },
  ];
  const suppliers: Record<string, string> = {};
  for (const supplier of supplierSpecs) {
    const record = await prisma.supplier.upsert({
      where: { organizationId_code: { organizationId, code: supplier.code } },
      update: { name: supplier.name },
      create: {
        organizationId,
        name: supplier.name,
        code: supplier.code,
        contactPerson: supplier.contact,
        phone: supplier.phone,
        city: supplier.city,
        state: spec.state,
      },
    });
    suppliers[supplier.name] = record.id;
  }

  // ---- Donors ----
  const donorSpecs = [
    {
      name: 'Shantaram Joshi', category: 'INDIVIDUAL' as const, phone: '9822110011', whatsapp: '9822110011',
      email: 'shantaram.joshi@example.com', pan: 'ABCPJ1234K', district: spec.city, village: 'Kothrud', language: 'mr', optIn: true,
      tags: ['Annadan', 'Monthly'], dob: '1956-08-15', anniversary: '1981-05-10',
      notes: 'Sponsors the Ekadashi annadan every month.',
    },
    {
      name: 'Kamala Devi Trust', category: 'TRUST' as const, phone: '02025530011', whatsapp: '9822110022',
      email: 'office@kamaladevitrust.example.org', pan: 'AAATK4455L', district: 'Mumbai', village: null, language: 'en', optIn: true,
      tags: ['Gurukul', 'CSR', 'Major Donor'], notes: 'Annual gurukul scholarship grant; receipts to the trust office.',
    },
    {
      name: 'Nitin Agarwal', category: 'INDIVIDUAL' as const, phone: '9822110033', whatsapp: null,
      email: 'nitin.agarwal@example.com', pan: 'ACDPA7788M', district: 'Nagpur', village: 'Hingna', language: 'en', optIn: false,
      tags: ['General'], dob: '1972-01-26', notes: 'Prefers cheque. Has not agreed to WhatsApp messages yet.',
    },
    {
      name: 'Lakshmi Foundation', category: 'ORGANIZATION' as const, phone: '9822110044', whatsapp: '9822110044',
      email: 'grants@lakshmifoundation.example.org', pan: 'AAALL9900N', district: spec.city, village: null, language: 'mr', optIn: true,
      tags: ['Gaushala', 'Major Donor'], notes: 'Supports cattle care and the veterinary fund.',
    },
    {
      name: 'Anonymous Well-wisher', category: 'INDIVIDUAL' as const, phone: null, whatsapp: null,
      email: null, pan: null, district: null, village: null, language: 'mr', optIn: false, tags: ['Anonymous'],
      notes: 'Cash offerings from the donation box.',
    },
    {
      name: 'Sunita Kulkarni', category: 'FAMILY' as const, phone: '9822110066', whatsapp: '9822110066',
      email: 'sunita.k@example.com', pan: null, district: spec.city, village: 'Wagholi', language: 'mr', optIn: true,
      tags: ['Annadan', 'Festival'], anniversary: '1998-11-22', notes: 'Family seva on Guru Purnima.',
    },
  ];
  const donors: Record<string, string> = {};
  let donorSerial = 0;
  for (const donor of donorSpecs) {
    donorSerial += 1;
    const code = `DNR-${String(donorSerial).padStart(5, '0')}`;
    const record = await prisma.donor.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: {},
      create: {
        organizationId,
        code,
        name: donor.name,
        category: donor.category,
        phone: donor.phone,
        whatsappNumber: donor.whatsapp,
        email: donor.email,
        panNumber: donor.pan,
        state: donor.district ? spec.state : null,
        district: donor.district,
        village: donor.village,
        preferredLanguage: donor.language,
        tags: donor.tags,
        dateOfBirth: 'dob' in donor && donor.dob ? new Date(donor.dob) : null,
        anniversaryDate: 'anniversary' in donor && donor.anniversary ? new Date(donor.anniversary) : null,
        notes: donor.notes,
        whatsappOptIn: donor.optIn,
        whatsappOptInAt: donor.optIn ? daysAgo(120) : null,
        createdById: users.ACCOUNTANT,
      },
    });
    donors[donor.name] = record.id;
  }
  // Keep the donor code counter ahead of the seeded codes.
  await prisma.numberSequence.upsert({
    where: { organizationId_key_year: { organizationId, key: 'DONOR', year: 0 } },
    create: { organizationId, key: 'DONOR', prefix: 'DNR', year: 0, nextValue: donorSerial + 1, padding: 5 },
    update: { nextValue: donorSerial + 1 },
  });

  return { organizationId, users, roles, accounts, banks, departments, funds, costCenters, categories, suppliers, donors, spec };
}

type SeedContext = Awaited<ReturnType<typeof seedOrganization>>;

/** Allocates document numbers the same way the API's sequence helper does. */
async function allocate(organizationId: string, key: string, prefix: string, date: Date) {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const year = startYear + 1;
  const sequence = await prisma.numberSequence.upsert({
    where: { organizationId_key_year: { organizationId, key, year } },
    create: { organizationId, key, prefix, year, nextValue: 2, padding: 5 },
    update: { nextValue: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(sequence.nextValue - 1).padStart(sequence.padding, '0')}`;
}

async function postJournal(
  organizationId: string,
  date: Date,
  type: 'EXPENSE' | 'DONATION' | 'INCOME',
  narration: string,
  lines: { accountId: string; debit?: number; credit?: number; description?: string; fundId?: string; departmentId?: string }[],
  source: { sourceType: string; sourceId: string; expenseId?: string },
  createdById: string,
) {
  const voucherNumber = await allocate(organizationId, 'VOUCHER', 'JV', date);
  const amount = lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
  await prisma.transaction.create({
    data: {
      organizationId,
      voucherNumber,
      date,
      type,
      narration,
      amount: dec(amount),
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      expenseId: source.expenseId ?? null,
      createdById,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          debit: dec(line.debit ?? 0),
          credit: dec(line.credit ?? 0),
          description: line.description ?? null,
          fundId: line.fundId ?? null,
          departmentId: line.departmentId ?? null,
        })),
      },
    },
  });
}

async function seedDonations(ctx: SeedContext) {
  const { organizationId, users, funds, departments, banks, donors, spec } = ctx;
  const scale = spec.rich ? 1 : 0.18;

  // Donations total ₹5,20,000; with other income this makes the ₹8,20,000
  // income figure the dashboard reports for the current financial year.
  const donationSpecs = [
    { donor: 'Kamala Devi Trust', amount: 150_000, fund: 'Gurukul Fund', department: 'Gurukul', mode: 'BANK_TRANSFER' as const, bank: 'SBI Bank — Main', days: 88, purpose: 'Classroom renovation support' },
    { donor: 'Lakshmi Foundation', amount: 120_000, fund: 'Gaushala Fund', department: 'Gaushala', mode: 'BANK_TRANSFER' as const, bank: 'HDFC Bank — Projects', days: 74, purpose: 'Cattle care and fodder' },
    { donor: 'Shantaram Joshi', amount: 80_000, fund: 'Annadan Fund', department: 'Annadan', mode: 'UPI' as const, bank: 'UPI Wallet', days: 61, purpose: 'Daily meal service' },
    { donor: 'Nitin Agarwal', amount: 60_000, fund: 'General Fund', department: 'Ashram', mode: 'CHEQUE' as const, bank: 'SBI Bank — Main', days: 47, purpose: 'General corpus' },
    { donor: 'Anonymous Well-wisher', amount: 40_000, fund: 'General Fund', department: null, mode: 'CASH' as const, bank: null, days: 33, purpose: 'Anonymous offering' },
    { donor: 'Kamala Devi Trust', amount: 45_000, fund: 'Gurukul Fund', department: 'Gurukul', mode: 'BANK_TRANSFER' as const, bank: 'SBI Bank — Main', days: 20, purpose: 'Scholarship fund' },
    { donor: 'Lakshmi Foundation', amount: 25_000, fund: 'Gaushala Fund', department: 'Gaushala', mode: 'UPI' as const, bank: 'UPI Wallet', days: 9, purpose: 'Veterinary care' },
  ];

  for (const donation of donationSpecs) {
    const date = daysAgo(donation.days);
    const amount = Math.round(donation.amount * scale);
    const receiptNumber = await allocate(organizationId, 'DONATION', 'DON', date);

    const created = await prisma.donation.create({
      data: {
        organizationId,
        receiptNumber,
        date,
        donorId: ctx.donors[donation.donor],
        donorName: donation.donor,
        amount: dec(amount),
        mode: donation.mode,
        fundId: funds[donation.fund],
        departmentId: donation.department ? departments[donation.department] : null,
        bankAccountId: donation.bank ? banks[donation.bank] : null,
        purpose: donation.purpose,
        referenceNumber: donation.mode === 'CHEQUE' ? `CHQ-${Math.floor(100000 + Math.random() * 899999)}` : null,
        createdById: users.ACCOUNTANT,
      },
    });

    const debitCode = donation.bank
      ? { 'SBI Bank — Main': '1101', 'HDFC Bank — Projects': '1102', 'UPI Wallet': '1104' }[donation.bank] ?? '1103'
      : '1103';

    await postJournal(
      organizationId,
      date,
      'DONATION',
      `${receiptNumber} — Donation from ${donation.donor}`,
      [
        { accountId: ctx.accounts[debitCode], debit: amount, description: 'Donation received', fundId: funds[donation.fund] },
        { accountId: ctx.accounts['4101'], credit: amount, description: donation.donor, fundId: funds[donation.fund] },
      ],
      { sourceType: 'Donation', sourceId: created.id },
      users.ACCOUNTANT,
    );
  }
  void donors;
}

async function seedIncome(ctx: SeedContext) {
  const { organizationId, users, funds, departments, banks, spec } = ctx;
  const scale = spec.rich ? 1 : 0.18;

  // Other income totals ₹3,00,000.
  const incomeSpecs = [
    { source: 'Gurukul Fees', amount: 120_000, fund: 'Gurukul Fund', department: 'Gurukul', bank: 'SBI Bank — Main', days: 80 },
    { source: 'Government Grant', amount: 90_000, fund: 'General Fund', department: null, bank: 'HDFC Bank — Projects', days: 55 },
    { source: 'Milk Sales', amount: 35_000, fund: 'Gaushala Fund', department: 'Gaushala', bank: 'SBI Bank — Main', days: 35 },
    { source: 'Hall Rent', amount: 25_000, fund: 'General Fund', department: 'Ashram', bank: 'SBI Bank — Main', days: 18 },
    { source: 'Gurukul Fees', amount: 30_000, fund: 'Gurukul Fund', department: 'Gurukul', bank: 'SBI Bank — Main', days: 6 },
  ];

  for (const income of incomeSpecs) {
    const date = daysAgo(income.days);
    const amount = Math.round(income.amount * scale);
    const entryNumber = await allocate(organizationId, 'INCOME', 'INC', date);

    const created = await prisma.incomeEntry.create({
      data: {
        organizationId,
        entryNumber,
        date,
        source: income.source,
        amount: dec(amount),
        fundId: funds[income.fund],
        departmentId: income.department ? departments[income.department] : null,
        bankAccountId: banks[income.bank],
        method: 'BANK_TRANSFER',
        createdById: users.ACCOUNTANT,
      },
    });

    const debitCode = { 'SBI Bank — Main': '1101', 'HDFC Bank — Projects': '1102' }[income.bank] ?? '1103';
    const creditCode = income.source === 'Gurukul Fees' ? '4103' : income.source === 'Government Grant' ? '4102' : '4199';

    await postJournal(
      organizationId,
      date,
      'INCOME',
      `${entryNumber} — ${income.source}`,
      [
        { accountId: ctx.accounts[debitCode], debit: amount, description: income.source, fundId: funds[income.fund] },
        { accountId: ctx.accounts[creditCode], credit: amount, description: income.source, fundId: funds[income.fund] },
      ],
      { sourceType: 'IncomeEntry', sourceId: created.id },
      users.ACCOUNTANT,
    );
  }
}

interface ExpenseSpec {
  title: string;
  department: string;
  fund: string;
  costCenter: string;
  category: string;
  supplier: string;
  days: number;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ACCOUNTING_POSTED';
  /** Keyed in by an admin for another user. */
  raisedByAdminFor?: 'ACCOUNTANT';
  bank?: string;
  method?: 'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CHEQUE';
  items: { description: string; quantity: number; unit: string; rate: number; taxRate: number }[];
}

async function seedExpenses(ctx: SeedContext) {
  const { organizationId, users, departments, funds, costCenters, categories, suppliers, banks, spec } = ctx;
  const scale = spec.rich ? 1 : 0.2;

  // Posted expenses total ₹6,80,000 for the year:
  //   approved but unpaid ₹1,85,000 (the payables figure)
  //   awaiting approval    ₹1,10,000
  //   settled and posted   ₹3,85,000 (the payments that reduce the balance)
  // Draft and rejected entries are deliberately excluded from those totals.
  const expenseSpecs: ExpenseSpec[] = [
    // --- Approved, payment still outstanding → payables ₹1,85,000 ---
    {
      title: 'Gaushala Feed', department: 'Gaushala', fund: 'Gaushala Fund', costCenter: 'Cow Shed 1',
      category: 'Cattle Feed', supplier: 'ABC Fodder Supplier', days: 3, status: 'APPROVED',
      items: [
        { description: 'Green Fodder', quantity: 500, unit: 'KG', rate: 8, taxRate: 0 },
        { description: 'Dry Fodder', quantity: 300, unit: 'KG', rate: 10, taxRate: 0 },
        { description: 'Mineral Mixture', quantity: 60, unit: 'KG', rate: 300, taxRate: 0 },
      ],
    },
    {
      title: 'Gaushala Shed Roofing', department: 'Gaushala', fund: 'Gaushala Fund', costCenter: 'Cow Shed 1',
      category: 'Repair & Maintenance', supplier: 'Shree Hardware & Repairs', days: 29, status: 'APPROVED',
      items: [
        { description: 'GI roofing sheets', quantity: 40, unit: 'NOS', rate: 1_250, taxRate: 0 },
        { description: 'Labour charges', quantity: 10, unit: 'DAY', rate: 1_000, taxRate: 0 },
      ],
    },
    {
      title: 'Staff Honorarium — September', department: 'Gurukul', fund: 'Gurukul Fund', costCenter: 'Primary Wing',
      category: 'Salaries & Honorarium', supplier: 'Vidya Book Depot', days: 6, status: 'APPROVED',
      items: [{ description: 'Teaching staff honorarium', quantity: 10, unit: 'NOS', rate: 10_000, taxRate: 0 }],
    },

    // --- Awaiting approval → ₹1,10,000 ---
    {
      title: 'Annadan Provisions — Rice & Dal', department: 'Annadan', fund: 'Annadan Fund', costCenter: 'Main Kitchen',
      category: 'Food & Provisions', supplier: 'Annapurna Provisions', days: 8, status: 'PENDING_APPROVAL',
      items: [
        { description: 'Rice', quantity: 500, unit: 'KG', rate: 52, taxRate: 0 },
        { description: 'Toor Dal', quantity: 250, unit: 'KG', rate: 120, taxRate: 0 },
        { description: 'Cooking Oil', quantity: 100, unit: 'LTR', rate: 150, taxRate: 0 },
      ],
    },
    {
      title: 'Classroom Fan Replacement', department: 'Gurukul', fund: 'Gurukul Fund', costCenter: 'Secondary Wing',
      category: 'Repair & Maintenance', supplier: 'Shree Hardware & Repairs', days: 5, status: 'PENDING_APPROVAL',
      raisedByAdminFor: 'ACCOUNTANT',
      items: [{ description: 'Ceiling fans', quantity: 20, unit: 'NOS', rate: 1_950, taxRate: 0 }],
    },

    // --- Settled and posted to the ledger → ₹3,85,000 ---
    {
      title: 'Electricity Bill — September', department: 'Ashram', fund: 'General Fund', costCenter: 'Guest House',
      category: 'Electricity', supplier: 'MSEB Electricity Board', days: 12, status: 'ACCOUNTING_POSTED',
      bank: 'SBI Bank — Main', method: 'BANK_TRANSFER',
      items: [{ description: 'Electricity units consumed (Sep)', quantity: 1, unit: 'NOS', rate: 18_500, taxRate: 0 }],
    },
    {
      title: 'Water Pump Repair', department: 'Ashram', fund: 'General Fund', costCenter: 'Guest House',
      category: 'Repair & Maintenance', supplier: 'Shree Hardware & Repairs', days: 19, status: 'ACCOUNTING_POSTED',
      bank: 'Cash in Hand', method: 'CASH',
      items: [
        { description: 'Submersible pump servicing', quantity: 1, unit: 'NOS', rate: 8_000, taxRate: 0 },
        { description: 'Replacement pipes', quantity: 4, unit: 'MTR', rate: 1_000, taxRate: 0 },
      ],
    },
    {
      title: 'Gurukul Textbooks', department: 'Gurukul', fund: 'Gurukul Fund', costCenter: 'Primary Wing',
      category: 'Books & Stationery', supplier: 'Vidya Book Depot', days: 26, status: 'ACCOUNTING_POSTED',
      bank: 'HDFC Bank — Projects', method: 'BANK_TRANSFER',
      items: [
        { description: 'Class 5 textbook set', quantity: 40, unit: 'SET', rate: 150, taxRate: 0 },
        { description: 'Notebooks', quantity: 250, unit: 'NOS', rate: 10, taxRate: 0 },
      ],
    },
    {
      title: 'Medical Camp Supplies', department: 'Ashram', fund: 'General Fund', costCenter: 'Dispensary',
      category: 'Medical', supplier: 'Arogya Medical Stores', days: 31, status: 'ACCOUNTING_POSTED',
      bank: 'UPI Wallet', method: 'UPI',
      items: [
        { description: 'General medicines', quantity: 1, unit: 'BOX', rate: 4_200, taxRate: 0 },
        { description: 'First aid kits', quantity: 8, unit: 'NOS', rate: 275, taxRate: 0 },
      ],
    },
    {
      title: 'Annadan Hall Renovation', department: 'Annadan', fund: 'Annadan Fund', costCenter: 'Main Kitchen',
      category: 'Repair & Maintenance', supplier: 'Shree Hardware & Repairs', days: 44, status: 'ACCOUNTING_POSTED',
      bank: 'SBI Bank — Main', method: 'CHEQUE',
      items: [{ description: 'Civil work — dining hall flooring', quantity: 1, unit: 'NOS', rate: 50_000, taxRate: 18 }],
    },
    {
      title: 'Annadan Provisions — August', department: 'Annadan', fund: 'Annadan Fund', costCenter: 'Main Kitchen',
      category: 'Food & Provisions', supplier: 'Annapurna Provisions', days: 38, status: 'ACCOUNTING_POSTED',
      bank: 'HDFC Bank — Projects', method: 'BANK_TRANSFER',
      items: [
        { description: 'Wheat flour', quantity: 500, unit: 'KG', rate: 44, taxRate: 5 },
        { description: 'Sugar', quantity: 300, unit: 'KG', rate: 60, taxRate: 5 },
      ],
    },
    {
      title: 'Staff Honorarium — August', department: 'Gurukul', fund: 'Gurukul Fund', costCenter: 'Primary Wing',
      category: 'Salaries & Honorarium', supplier: 'Vidya Book Depot', days: 40, status: 'ACCOUNTING_POSTED',
      bank: 'SBI Bank — Main', method: 'BANK_TRANSFER',
      items: [{ description: 'Teaching staff honorarium', quantity: 20, unit: 'NOS', rate: 9_000, taxRate: 0 }],
    },
    {
      title: 'Vehicle Fuel & Maintenance', department: 'Ashram', fund: 'General Fund', costCenter: 'Guest House',
      category: 'Transport & Fuel', supplier: 'Shree Hardware & Repairs', days: 22, status: 'ACCOUNTING_POSTED',
      bank: 'Cash in Hand', method: 'CASH',
      items: [{ description: 'Diesel', quantity: 586, unit: 'LTR', rate: 100, taxRate: 0 }],
    },

    // --- Excluded from reported totals ---
    {
      title: 'Gaushala Veterinary Visit', department: 'Gaushala', fund: 'Gaushala Fund', costCenter: 'Cow Shed 2',
      category: 'Medical', supplier: 'Arogya Medical Stores', days: 2, status: 'DRAFT',
      items: [{ description: 'Veterinary consultation & medicines', quantity: 1, unit: 'NOS', rate: 6_400, taxRate: 0 }],
    },
    {
      title: 'Kitchen Gas Cylinders', department: 'Annadan', fund: 'Annadan Fund', costCenter: 'Main Kitchen',
      category: 'Food & Provisions', supplier: 'Annapurna Provisions', days: 15, status: 'REJECTED',
      items: [{ description: 'Commercial LPG cylinder', quantity: 4, unit: 'NOS', rate: 1_900, taxRate: 0 }],
    },
  ];

  const bankCodes: Record<string, string> = {
    'SBI Bank — Main': '1101',
    'HDFC Bank — Projects': '1102',
    'Cash in Hand': '1103',
    'UPI Wallet': '1104',
  };

  for (const expenseSpec of expenseSpecs) {
    const date = daysAgo(expenseSpec.days);
    const expenseNumber = await allocate(organizationId, 'EXPENSE', 'EXP', date);

    let subtotal = 0;
    let tax = 0;
    const items = expenseSpec.items.map((item, index) => {
      const rate = item.rate;
      const quantity = spec.rich ? item.quantity : Math.max(1, Math.round(item.quantity * scale));
      const base = Math.round(quantity * rate * 100) / 100;
      const taxAmount = Math.round(((base * item.taxRate) / 100) * 100) / 100;
      subtotal = Math.round((subtotal + base) * 100) / 100;
      tax = Math.round((tax + taxAmount) * 100) / 100;
      return {
        description: item.description,
        quantity: new Prisma.Decimal(quantity),
        unit: item.unit,
        rate: dec(rate),
        taxRate: new Prisma.Decimal(item.taxRate),
        taxAmount: dec(taxAmount),
        amount: dec(base + taxAmount),
        sortOrder: index,
      };
    });
    const total = Math.round((subtotal + tax) * 100) / 100;

    const isSettled = expenseSpec.status === 'ACCOUNTING_POSTED';
    const isApprovedOrBeyond = isSettled || expenseSpec.status === 'APPROVED';
    const submittedAt = expenseSpec.status === 'DRAFT' ? null : daysAgo(expenseSpec.days - 0.5);
    const approvedAt = isApprovedOrBeyond ? daysAgo(Math.max(0, expenseSpec.days - 1)) : null;

    const expense = await prisma.expense.create({
      data: {
        organizationId,
        expenseNumber,
        date,
        title: expenseSpec.title,
        departmentId: departments[expenseSpec.department],
        fundId: funds[expenseSpec.fund],
        costCenterId: costCenters[expenseSpec.costCenter],
        categoryId: categories[expenseSpec.category],
        supplierId: suppliers[expenseSpec.supplier],
        subtotal: dec(subtotal),
        tax: dec(tax),
        total: dec(total),
        paidAmount: dec(isSettled ? total : 0),
        status: expenseSpec.status,
        paymentStatus: isSettled ? 'PAID' : 'UNPAID',
        paymentMethod: isSettled ? expenseSpec.method ?? 'BANK_TRANSFER' : null,
        paymentAccountId: isSettled && expenseSpec.bank ? banks[expenseSpec.bank] : null,
        referenceNumber: isSettled ? `REF-${Math.floor(100000 + Math.random() * 899999)}` : null,
        paymentDate: isSettled ? daysAgo(Math.max(0, expenseSpec.days - 2)) : null,
        rejectionReason:
          expenseSpec.status === 'REJECTED' ? 'Quotation required from a second supplier before approval.' : null,
        submittedAt,
        approvedAt,
        createdById: expenseSpec.raisedByAdminFor ? users.ADMIN : users.ACCOUNTANT,
        onBehalfOfId: expenseSpec.raisedByAdminFor ? users[expenseSpec.raisedByAdminFor] : null,
        approvedById: isApprovedOrBeyond ? users.APPROVER : null,
        description: `${expenseSpec.category} for ${expenseSpec.department}`,
        items: { create: items },
      },
    });

    // Approval trail
    if (expenseSpec.status !== 'DRAFT') {
      await prisma.approval.create({
        data: {
          organizationId,
          expenseId: expense.id,
          level: 1,
          decision:
            expenseSpec.status === 'PENDING_APPROVAL'
              ? 'PENDING'
              : expenseSpec.status === 'REJECTED'
                ? 'REJECTED'
                : 'APPROVED',
          requestedById: users.ACCOUNTANT,
          actorId: expenseSpec.status === 'PENDING_APPROVAL' ? null : users.APPROVER,
          comments:
            expenseSpec.status === 'REJECTED'
              ? 'Quotation required from a second supplier before approval.'
              : expenseSpec.status === 'PENDING_APPROVAL'
                ? 'Submitted for your approval.'
                : 'Approved — within department budget.',
          requestedAt: submittedAt ?? date,
          decidedAt: expenseSpec.status === 'PENDING_APPROVAL' ? null : approvedAt ?? date,
        },
      });
    }

    // Payment + ledger posting for settled expenses
    if (isSettled) {
      const paymentDate = daysAgo(Math.max(0, expenseSpec.days - 2));
      const paymentNumber = await allocate(organizationId, 'PAYMENT', 'PAY', paymentDate);
      await prisma.payment.create({
        data: {
          organizationId,
          paymentNumber,
          expenseId: expense.id,
          date: paymentDate,
          amount: dec(total),
          method: expenseSpec.method ?? 'BANK_TRANSFER',
          bankAccountId: expenseSpec.bank ? banks[expenseSpec.bank] : null,
          referenceNumber: `REF-${Math.floor(100000 + Math.random() * 899999)}`,
          createdById: users.ACCOUNTANT,
        },
      });

      const categoryAccount = await prisma.expenseCategory.findUnique({
        where: { id: categories[expenseSpec.category] },
        select: { accountId: true },
      });
      const creditCode = expenseSpec.bank ? bankCodes[expenseSpec.bank] : '2100';

      await postJournal(
        organizationId,
        paymentDate,
        'EXPENSE',
        `${expenseNumber} — ${expenseSpec.title}`,
        [
          {
            accountId: categoryAccount?.accountId ?? ctx.accounts['5199'],
            debit: total,
            description: `${expenseSpec.category} — ${expenseSpec.department}`,
            fundId: funds[expenseSpec.fund],
            departmentId: departments[expenseSpec.department],
          },
          {
            accountId: ctx.accounts[creditCode],
            credit: total,
            description: `Paid for ${expenseNumber}`,
            fundId: funds[expenseSpec.fund],
            departmentId: departments[expenseSpec.department],
          },
        ],
        { sourceType: 'Expense', sourceId: expense.id, expenseId: expense.id },
        users.ACCOUNTANT,
      );
    }

    // Audit trail
    const auditEntries: { action: string; userId: string; at: Date; newValue?: unknown }[] = [
      { action: 'expense.created', userId: users.ACCOUNTANT, at: date, newValue: { status: 'DRAFT', total } },
    ];
    if (submittedAt) {
      auditEntries.push({ action: 'expense.submitted', userId: users.ACCOUNTANT, at: submittedAt, newValue: { status: 'PENDING_APPROVAL' } });
    }
    if (expenseSpec.status === 'REJECTED') {
      auditEntries.push({ action: 'expense.rejected', userId: users.APPROVER, at: approvedAt ?? date, newValue: { status: 'REJECTED' } });
    } else if (isApprovedOrBeyond) {
      auditEntries.push({ action: 'expense.approved', userId: users.APPROVER, at: approvedAt ?? date, newValue: { status: 'APPROVED' } });
    }
    if (isSettled) {
      auditEntries.push({ action: 'payment.recorded', userId: users.ACCOUNTANT, at: daysAgo(Math.max(0, expenseSpec.days - 2)), newValue: { amount: total } });
      auditEntries.push({ action: 'accounting.posted', userId: users.ACCOUNTANT, at: daysAgo(Math.max(0, expenseSpec.days - 2)), newValue: { status: 'ACCOUNTING_POSTED' } });
    }

    for (const entry of auditEntries) {
      await prisma.auditLog.create({
        data: {
          organizationId,
          userId: entry.userId,
          action: entry.action,
          entityType: 'Expense',
          entityId: expense.id,
          entityLabel: expenseNumber,
          newValue: (entry.newValue ?? undefined) as never,
          timestamp: entry.at,
        },
      });
    }

    // Notifications for the items that still need attention
    if (expenseSpec.status === 'PENDING_APPROVAL') {
      await prisma.notification.createMany({
        data: [users.APPROVER, users.FINANCE_MANAGER].map((userId) => ({
          organizationId,
          userId,
          type: 'EXPENSE_SUBMITTED' as const,
          title: 'Expense submitted for approval',
          message: `${expenseNumber} — ${expenseSpec.title} for ₹${total.toLocaleString('en-IN')} needs your approval.`,
          link: `/expenses/${expense.id}`,
          entityType: 'Expense',
          entityId: expense.id,
          createdAt: submittedAt ?? date,
        })),
      });
    }
  }
}

async function seedPurchases(ctx: SeedContext) {
  const { organizationId, users, departments, funds, categories, suppliers, spec } = ctx;
  const scale = spec.rich ? 1 : 0.2;

  const orderSpecs = [
    {
      supplier: 'ABC Fodder Supplier', department: 'Gaushala', fund: 'Gaushala Fund', category: 'Cattle Feed',
      days: 10, status: 'ORDERED' as const,
      items: [{ description: 'Green fodder — monthly contract', quantity: 2000, unit: 'KG', rate: 8, taxRate: 0 }],
    },
    {
      supplier: 'Vidya Book Depot', department: 'Gurukul', fund: 'Gurukul Fund', category: 'Books & Stationery',
      days: 24, status: 'RECEIVED' as const,
      items: [
        { description: 'Library books', quantity: 80, unit: 'NOS', rate: 320, taxRate: 0 },
        { description: 'Chart paper', quantity: 200, unit: 'NOS', rate: 12, taxRate: 12 },
      ],
    },
    {
      supplier: 'Annapurna Provisions', department: 'Annadan', fund: 'Annadan Fund', category: 'Food & Provisions',
      days: 4, status: 'DRAFT' as const,
      items: [{ description: 'Wheat flour', quantity: 300, unit: 'KG', rate: 42, taxRate: 0 }],
    },
  ];

  for (const orderSpec of orderSpecs) {
    const date = daysAgo(orderSpec.days);
    const orderNumber = await allocate(organizationId, 'PURCHASE', 'PO', date);

    let subtotal = 0;
    let tax = 0;
    const items = orderSpec.items.map((item, index) => {
      const quantity = spec.rich ? item.quantity : Math.max(1, Math.round(item.quantity * scale));
      const base = Math.round(quantity * item.rate * 100) / 100;
      const taxAmount = Math.round(((base * item.taxRate) / 100) * 100) / 100;
      subtotal = Math.round((subtotal + base) * 100) / 100;
      tax = Math.round((tax + taxAmount) * 100) / 100;
      return {
        description: item.description,
        quantity: new Prisma.Decimal(quantity),
        unit: item.unit,
        rate: dec(item.rate),
        taxRate: new Prisma.Decimal(item.taxRate),
        amount: dec(base + taxAmount),
        sortOrder: index,
      };
    });

    await prisma.purchaseOrder.create({
      data: {
        organizationId,
        orderNumber,
        date,
        expectedDate: daysAgo(orderSpec.days - 7),
        supplierId: suppliers[orderSpec.supplier],
        departmentId: departments[orderSpec.department],
        fundId: funds[orderSpec.fund],
        categoryId: categories[orderSpec.category],
        subtotal: dec(subtotal),
        tax: dec(tax),
        total: dec(subtotal + tax),
        status: orderSpec.status,
        createdById: users.ACCOUNTANT,
        items: { create: items },
      },
    });
  }
}

async function seedTransfers(ctx: SeedContext) {
  const { organizationId, users, banks, spec } = ctx;
  const date = daysAgo(14);
  const amount = spec.rich ? 200_000 : 30_000;
  const transferNumber = await allocate(organizationId, 'TRANSFER', 'TRF', date);

  await prisma.bankTransfer.create({
    data: {
      organizationId,
      transferNumber,
      date,
      fromAccountId: banks['SBI Bank — Main'],
      toAccountId: banks['HDFC Bank — Projects'],
      amount: dec(amount),
      referenceNumber: 'NEFT-884512',
      notes: 'Allocation to project account',
      createdById: users.FINANCE_MANAGER,
    },
  });
}

async function main() {
  console.log('\nSeeding Ashram Management…\n');

  await seedPermissionCatalog();

  const organizations: OrgSpec[] = [
    {
      slug: 'ashram-management',
      name: 'Ashram Management',
      legalName: 'Shree Seva Ashram Charitable Foundation',
      city: 'Pune',
      state: 'Maharashtra',
      emailDomain: 'ashram.org',
      rich: true,
    },
    {
      slug: 'sadhana-kendra',
      name: 'Sadhana Kendra',
      legalName: 'Sadhana Kendra Gurukul Trust',
      city: 'Nashik',
      state: 'Maharashtra',
      emailDomain: 'sadhanakendra.org',
      rich: false,
    },
  ];

  for (const spec of organizations) {
    console.log(`\n  Organization: ${spec.name}`);
    const ctx = await seedOrganization(spec);
    console.log('  ✓ roles, users, masters, chart of accounts');

    await seedDonations(ctx);
    await seedIncome(ctx);
    console.log('  ✓ donations & income');

    await seedExpenses(ctx);
    console.log('  ✓ expenses across every workflow state');

    await seedPurchases(ctx);
    await seedTransfers(ctx);
    console.log('  ✓ purchase orders & bank transfer');
  }

  console.log('\n────────────────────────────────────────────────');
  console.log('  Sign in with password:  Ashram@2026');
  console.log('');
  console.log('  Organization 1 — Ashram Management');
  console.log('    admin@ashram.org       Admin User');
  console.log('    finance@ashram.org     Finance Manager');
  console.log('    accounts@ashram.org    Accountant');
  console.log('    approver@ashram.org    Approver');
  console.log('');
  console.log('  Organization 2 — Sadhana Kendra (tenant isolation check)');
  console.log('    admin@sadhanakendra.org');
  console.log('────────────────────────────────────────────────\n');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
