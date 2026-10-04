import PDFDocument from 'pdfkit';
import { DOMAIN_LABELS, type Locale } from '@ashram/types';
import { formatINR, toNumber } from '../../lib/money';
import { PDF_FONTS, formatDateFor, tr } from '../../lib/i18n';

type AnyExpense = Record<string, any>;

const INK = '#1B2232';
const MUTED = '#626F84';
const LINE = '#DCE0E6';
const BRAND = '#0657D6';

/** Renders the printable expense voucher, in the reader's language. */
export function buildExpensePdf(expense: AnyExpense, organization: AnyExpense, locale: Locale = 'en'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('body', PDF_FONTS.regular);
    doc.registerFont('bold', PDF_FONTS.bold);

    const labels = DOMAIN_LABELS[locale];
    const t = (text: string) => tr(locale, text);
    const upper = (text: string) => (locale === 'mr' ? t(text) : t(text).toUpperCase());

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    doc.rect(0, 0, doc.page.width, 84).fill(BRAND);
    doc.fillColor('#FFFFFF').fontSize(17).font('bold').text(organization.name ?? 'Ashram Management', left, 22, { width: width * 0.6 });
    doc
      .fontSize(9)
      .font('body')
      .fillColor('#D6EBE3')
      .text(organization.tagline ?? 'Service • Education • Compassion', left, 48, { width: width * 0.6 });
    doc.fontSize(13).font('bold').fillColor('#FFFFFF').text(t('EXPENSE VOUCHER'), left, 22, { width, align: 'right' });
    doc.fontSize(10).font('body').fillColor('#D6EBE3').text(expense.expenseNumber, left, 46, { width, align: 'right' });

    let y = 104;
    doc.fillColor(INK).font('bold').fontSize(14).text(expense.title, left, y, { width });
    y += 24;

    doc
      .font('body')
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(
        `${t('Status')}: ${labels.expenseStatus[expense.status] ?? expense.status}   •   ${t('Date')}: ${formatDateFor(locale, expense.date)}   •   ${t('Payment')}: ${labels.paymentStatus[expense.paymentStatus] ?? expense.paymentStatus}`,
        left,
        y,
      );
    y += 26;

    const meta: [string, string][] = [
      [t('Department'), expense.department?.name ?? '—'],
      [t('Fund'), expense.fund?.name ?? '—'],
      [t('Cost Center'), expense.costCenter?.name ?? '—'],
      [t('Category'), expense.category?.name ?? '—'],
      [t('Supplier'), expense.supplier?.name ?? '—'],
      [t('Requested By'), expense.onBehalfOf?.name ?? expense.createdBy?.name ?? '—'],
    ];
    const colWidth = width / 3;
    meta.forEach(([label, value], index) => {
      const x = left + (index % 3) * colWidth;
      const rowY = y + Math.floor(index / 3) * 38;
      doc.font('body').fontSize(8).fillColor(MUTED).text(locale === 'mr' ? label : label.toUpperCase(), x, rowY);
      doc.font('bold').fontSize(10.5).fillColor(INK).text(value, x, rowY + 12, { width: colWidth - 10, lineBreak: false, ellipsis: true });
    });
    y += Math.ceil(meta.length / 3) * 38 + 10;

    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 10;
    const cols = [
      { label: upper('DESCRIPTION'), x: left, w: width - 320, align: 'left' as const },
      { label: upper('QTY'), x: left + width - 320, w: 55, align: 'right' as const },
      { label: upper('UNIT'), x: left + width - 262, w: 45, align: 'left' as const },
      { label: upper('RATE'), x: left + width - 215, w: 70, align: 'right' as const },
      { label: upper('TAX'), x: left + width - 142, w: 50, align: 'right' as const },
      { label: upper('AMOUNT'), x: left + width - 90, w: 90, align: 'right' as const },
    ];
    doc.font('bold').fontSize(8).fillColor(MUTED);
    cols.forEach((col) => doc.text(col.label, col.x, y, { width: col.w, align: col.align }));
    y += 16;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 8;

    doc.font('body').fontSize(9.5).fillColor(INK);
    for (const item of expense.items ?? []) {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 60;
      }
      const values = [
        item.description,
        String(toNumber(item.quantity)),
        item.unit,
        formatINR(toNumber(item.rate), false),
        `${toNumber(item.taxRate)}%`,
        formatINR(toNumber(item.amount), false),
      ];
      cols.forEach((col, index) =>
        doc.text(values[index], col.x, y, { width: col.w, align: col.align, lineBreak: false, ellipsis: true }),
      );
      y += 19;
    }

    y += 4;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 10;

    const totals: [string, number, boolean][] = [
      [t('Subtotal'), toNumber(expense.subtotal), false],
      [t('Tax'), toNumber(expense.tax), false],
      [t('Total'), toNumber(expense.total), true],
    ];
    totals.forEach(([label, value, bold]) => {
      doc.font(bold ? 'bold' : 'body').fontSize(bold ? 11.5 : 9.5).fillColor(bold ? INK : MUTED);
      doc.text(label, right - 230, y, { width: 120, align: 'right' });
      doc.text(formatINR(value), right - 105, y, { width: 105, align: 'right' });
      y += bold ? 22 : 16;
    });

    y += 10;
    doc.font('bold').fontSize(9.5).fillColor(INK).text(upper('APPROVAL'), left, y);
    doc.text(upper('PAYMENT'), left + width / 2, y);
    y += 16;
    doc.font('body').fontSize(9.5).fillColor(MUTED);

    const approvalLines = [
      `${t('Requested by')}: ${expense.onBehalfOf?.name ?? expense.createdBy?.name ?? '—'}`,
      ...(expense.onBehalfOf ? [`${t('Entered by')}: ${expense.createdBy?.name ?? '—'}`] : []),
      `${t('Submitted')}: ${formatDateFor(locale, expense.submittedAt)}`,
      `${t('Approved by')}: ${expense.approvedBy?.name ?? '—'}`,
      `${t('Approved')}: ${formatDateFor(locale, expense.approvedAt)}`,
    ];
    const paymentLines = [
      `${t('Status')}: ${labels.paymentStatus[expense.paymentStatus] ?? expense.paymentStatus}`,
      `${t('Method')}: ${expense.paymentMethod ? labels.paymentMethod[expense.paymentMethod] : '—'}`,
      `${t('Reference')}: ${expense.referenceNumber ?? '—'}`,
      `${t('Paid on')}: ${formatDateFor(locale, expense.paymentDate)}`,
    ];
    approvalLines.forEach((line, i) => doc.text(line, left, y + i * 15, { width: width / 2 - 20 }));
    paymentLines.forEach((line, i) => doc.text(line, left + width / 2, y + i * 15, { width: width / 2 - 20 }));

    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${t('Generated on')} ${formatDateFor(locale, new Date(), true)} • ${t('This is a system generated voucher.')}`,
        left,
        doc.page.height - 62,
        { width, align: 'center' },
      );

    doc.end();
  });
}
