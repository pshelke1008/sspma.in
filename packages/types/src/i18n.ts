/**
 * Domain vocabulary in every supported language.
 *
 * Status names, payment methods and report titles are shown by the web app and
 * printed by the API into PDFs and spreadsheets; keeping both languages here
 * means a screen and its export can never disagree about a word.
 */
import type { Locale } from './index';

type Labels = Record<string, string>;

export interface DomainLabels {
  expenseStatus: Labels;
  paymentStatus: Labels;
  paymentMethod: Labels;
  donationMode: Labels;
  purchaseStatus: Labels;
  accountType: Labels;
  donorCategory: Labels;
  roles: Labels;
  reportGroups: Labels;
  reports: Record<string, { name: string; description: string }>;
}

export const DOMAIN_LABELS: Record<Locale, DomainLabels> = {
  en: {
    expenseStatus: {
      DRAFT: 'Draft',
      SUBMITTED: 'Submitted',
      PENDING_APPROVAL: 'Pending Approval',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      PAYMENT_PENDING: 'Payment Pending',
      PAID: 'Paid',
      ACCOUNTING_POSTED: 'Accounting Posted',
      CANCELLED: 'Cancelled',
    },
    paymentStatus: { UNPAID: 'Unpaid', PARTIAL: 'Partially Paid', PAID: 'Paid' },
    paymentMethod: { CASH: 'Cash', BANK_TRANSFER: 'Bank Transfer', UPI: 'UPI', CHEQUE: 'Cheque', OTHER: 'Other' },
    donationMode: {
      CASH: 'Cash',
      BANK_TRANSFER: 'Bank Transfer',
      UPI: 'UPI',
      CHEQUE: 'Cheque',
      ONLINE: 'Online',
      KIND: 'In Kind',
    },
    purchaseStatus: {
      DRAFT: 'Draft',
      ORDERED: 'Ordered',
      PARTIALLY_RECEIVED: 'Partially Received',
      RECEIVED: 'Received',
      CANCELLED: 'Cancelled',
    },
    accountType: { ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Fund / Reserve', INCOME: 'Income', EXPENSE: 'Expense' },
    donorCategory: {
      INDIVIDUAL: 'Individual',
      FAMILY: 'Family',
      TRUST: 'Trust',
      CORPORATE: 'Corporate',
      ORGANIZATION: 'Organization',
    },
    roles: { ADMIN: 'Admin User', FINANCE_MANAGER: 'Finance Manager', ACCOUNTANT: 'Accountant', APPROVER: 'Approver' },
    reportGroups: { FINANCIAL: 'Financial', MANAGEMENT: 'Management', DONATIONS: 'Donations', PAYABLES: 'Payables' },
    reports: {
      'income-expense': { name: 'Income & Expense', description: 'Month-wise income, expense and net surplus for the selected period.' },
      'balance-sheet': { name: 'Balance Sheet', description: 'Assets, liabilities and fund balances as on a given date.' },
      'trial-balance': { name: 'Trial Balance', description: 'Ledger-wise debit and credit totals with balancing check.' },
      'general-ledger': { name: 'General Ledger', description: 'Account-wise transaction detail with running balance.' },
      'cash-flow': { name: 'Cash Flow', description: 'Inflow, outflow and closing balance movement by month.' },
      'cash-book': { name: 'Cash Book', description: 'Day book of cash and bank receipts and payments.' },
      'fund-report': { name: 'Fund Report', description: 'Opening, inflow, outflow and closing balance per fund.' },
      'department-pl': { name: 'Department P&L', description: 'Income versus expense contribution for every department.' },
      'budget-vs-actual': { name: 'Budget vs Actual', description: 'Department budget utilisation and variance tracking.' },
      'expense-analysis': { name: 'Expense Analysis', description: 'Category-wise expense break-up with share of total spend.' },
      'donor-report': { name: 'Donor Report', description: 'Donor-wise contribution totals and last donation date.' },
      'donation-summary': { name: 'Donation Summary', description: 'Donation totals grouped by fund and receipt mode.' },
      'supplier-outstanding': { name: 'Supplier Outstanding', description: 'Unpaid and partially paid supplier balances by ageing.' },
      'payment-report': { name: 'Payment Report', description: 'All recorded payments with method, account and reference.' },
    },
  },
  mr: {
    expenseStatus: {
      DRAFT: 'मसुदा',
      SUBMITTED: 'सादर केले',
      PENDING_APPROVAL: 'मंजुरी प्रलंबित',
      APPROVED: 'मंजूर',
      REJECTED: 'नाकारले',
      PAYMENT_PENDING: 'भरणा प्रलंबित',
      PAID: 'भरले',
      ACCOUNTING_POSTED: 'लेखा नोंद झाली',
      CANCELLED: 'रद्द',
    },
    paymentStatus: { UNPAID: 'न भरलेले', PARTIAL: 'अंशतः भरलेले', PAID: 'भरले' },
    paymentMethod: { CASH: 'रोख', BANK_TRANSFER: 'बँक हस्तांतरण', UPI: 'UPI', CHEQUE: 'धनादेश', OTHER: 'इतर' },
    donationMode: {
      CASH: 'रोख',
      BANK_TRANSFER: 'बँक हस्तांतरण',
      UPI: 'UPI',
      CHEQUE: 'धनादेश',
      ONLINE: 'ऑनलाइन',
      KIND: 'वस्तुरूप',
    },
    purchaseStatus: {
      DRAFT: 'मसुदा',
      ORDERED: 'मागणी नोंदवली',
      PARTIALLY_RECEIVED: 'अंशतः प्राप्त',
      RECEIVED: 'प्राप्त',
      CANCELLED: 'रद्द',
    },
    accountType: { ASSET: 'मालमत्ता', LIABILITY: 'दायित्व', EQUITY: 'निधी / राखीव', INCOME: 'उत्पन्न', EXPENSE: 'खर्च' },
    donorCategory: {
      INDIVIDUAL: 'व्यक्ती',
      FAMILY: 'कुटुंब',
      TRUST: 'ट्रस्ट',
      CORPORATE: 'कंपनी',
      ORGANIZATION: 'संस्था',
    },
    roles: { ADMIN: 'प्रशासक', FINANCE_MANAGER: 'वित्त व्यवस्थापक', ACCOUNTANT: 'लेखापाल', APPROVER: 'मंजुरीदार' },
    reportGroups: { FINANCIAL: 'आर्थिक', MANAGEMENT: 'व्यवस्थापन', DONATIONS: 'देणग्या', PAYABLES: 'देय रक्कम' },
    reports: {
      'income-expense': { name: 'उत्पन्न आणि खर्च', description: 'निवडलेल्या कालावधीसाठी महिनावार उत्पन्न, खर्च आणि निव्वळ शिल्लक.' },
      'balance-sheet': { name: 'ताळेबंद', description: 'दिलेल्या तारखेनुसार मालमत्ता, दायित्वे आणि निधी शिल्लक.' },
      'trial-balance': { name: 'कच्चा ताळेबंद', description: 'खातेनिहाय नावे व जमा बेरीज, जुळणी तपासणीसह.' },
      'general-ledger': { name: 'सामान्य खातेवही', description: 'चालू शिलकीसह खातेनिहाय व्यवहारांचा तपशील.' },
      'cash-flow': { name: 'रोख प्रवाह', description: 'महिनावार आवक, जावक आणि अखेरची शिल्लक.' },
      'cash-book': { name: 'रोकड वही', description: 'रोख व बँकेतील जमा आणि खर्चाची दैनंदिन नोंद.' },
      'fund-report': { name: 'निधी अहवाल', description: 'प्रत्येक निधीची सुरुवातीची शिल्लक, आवक, जावक आणि अखेरची शिल्लक.' },
      'department-pl': { name: 'विभागनिहाय नफा-तोटा', description: 'प्रत्येक विभागाचे उत्पन्न विरुद्ध खर्च.' },
      'budget-vs-actual': { name: 'अंदाजपत्रक विरुद्ध प्रत्यक्ष', description: 'विभागीय अंदाजपत्रकाचा वापर आणि तफावत.' },
      'expense-analysis': { name: 'खर्च विश्लेषण', description: 'एकूण खर्चातील वाट्यासह वर्गनिहाय खर्च.' },
      'donor-report': { name: 'देणगीदार अहवाल', description: 'देणगीदारनिहाय एकूण देणगी आणि शेवटच्या देणगीची तारीख.' },
      'donation-summary': { name: 'देणगी सारांश', description: 'निधी आणि जमा पद्धतीनुसार देणग्यांची बेरीज.' },
      'supplier-outstanding': { name: 'पुरवठादार थकबाकी', description: 'कालावधीनुसार न भरलेली व अंशतः भरलेली पुरवठादार रक्कम.' },
      'payment-report': { name: 'भरणा अहवाल', description: 'पद्धत, खाते आणि संदर्भासह नोंदवलेले सर्व भरणे.' },
    },
  },
};
