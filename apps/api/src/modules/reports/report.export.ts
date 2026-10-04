import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Locale } from '@ashram/types';
import { formatINR } from '../../lib/money';
import { PDF_FONTS, formatDateFor, tr } from '../../lib/i18n';
import type { ReportColumn, ReportResult } from './report.types';

const BRAND = '#0657D6';
const INK = '#1B2232';
const MUTED = '#626F84';
const LINE = '#DCE0E6';

function cellValue(column: ReportColumn, value: unknown, locale: Locale): string {
  if (value === null || value === undefined || value === '') return '';
  switch (column.type) {
    case 'currency':
      return formatINR(Number(value), false);
    case 'percent':
      return `${Number(value).toFixed(1)}%`;
    case 'date':
      return formatDateFor(locale, String(value));
    default:
      return String(value);
  }
}

function periodLine(report: ReportResult, locale: Locale): string {
  return `${tr(locale, 'Period')}: ${formatDateFor(locale, report.period.from)} — ${formatDateFor(locale, report.period.to)}`;
}

/** CSV with RFC-4180 quoting; formula-injection prefixes are neutralised. */
export function toCsv(report: ReportResult, locale: Locale = 'en'): string {
  const escape = (raw: string) => {
    const value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${value.replace(/"/g, '""')}"`;
  };

  const lines: string[] = [escape(report.name), escape(periodLine(report, locale))];
  for (const [key, value] of Object.entries(report.filtersApplied)) lines.push(escape(`${key}: ${value}`));
  lines.push('');
  lines.push(report.columns.map((column) => escape(column.label)).join(','));
  for (const row of report.rows) {
    lines.push(report.columns.map((column) => escape(cellValue(column, row[column.key], locale))).join(','));
  }
  if (report.totalsRow) {
    lines.push(report.columns.map((column) => escape(cellValue(column, report.totalsRow![column.key], locale))).join(','));
  }
  // A byte-order mark makes Excel open UTF-8 (and so Marathi text) correctly.
  return `﻿${lines.join('\r\n')}`;
}

/** Styled workbook: summary block, header band, typed number formats. */
export async function toExcel(report: ReportResult, organizationName: string, locale: Locale = 'en'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ashram Management';
  workbook.created = new Date();

  // Sheet names cannot contain some characters and are capped at 31.
  const sheet = workbook.addWorksheet(report.name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 30), {
    views: [{ state: 'frozen', ySplit: 6 }],
  });
  const columnCount = report.columns.length;

  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell(1, 1).value = organizationName;
  sheet.getCell(1, 1).font = { size: 14, bold: true, color: { argb: 'FF0657D6' } };

  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell(2, 1).value = report.name;
  sheet.getCell(2, 1).font = { size: 12, bold: true, color: { argb: 'FF1B2232' } };

  sheet.mergeCells(3, 1, 3, columnCount);
  const filterText = Object.entries(report.filtersApplied)
    .map(([key, value]) => `${key}: ${value}`)
    .join('   •   ');
  sheet.getCell(3, 1).value = `${periodLine(report, locale)}${filterText ? `   •   ${filterText}` : ''}`;
  sheet.getCell(3, 1).font = { size: 10, color: { argb: 'FF626F84' } };

  sheet.mergeCells(4, 1, 4, columnCount);
  sheet.getCell(4, 1).value = report.summary
    .map((item) => `${item.label}: ${item.type === 'currency' ? formatINR(item.value) : item.value}`)
    .join('   |   ');
  sheet.getCell(4, 1).font = { size: 10, bold: true, color: { argb: 'FF0866FF' } };

  const headerRow = sheet.getRow(6);
  report.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0657D6' } };
    cell.alignment = { horizontal: column.align ?? 'left', vertical: 'middle' };
  });
  headerRow.height = 20;

  report.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(7 + rowIndex);
    report.columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      const raw = row[column.key];
      if (column.type === 'currency' || column.type === 'number' || column.type === 'percent') {
        cell.value = raw === '' || raw === null || raw === undefined ? '' : Number(raw);
        cell.numFmt = column.type === 'currency' ? '#,##0.00' : column.type === 'percent' ? '0.0"%"' : '#,##0';
      } else if (column.type === 'date') {
        cell.value = raw ? new Date(String(raw)) : '';
        cell.numFmt = 'dd mmm yyyy';
      } else {
        cell.value = raw === null || raw === undefined ? '' : String(raw);
      }
      cell.alignment = { horizontal: column.align ?? 'left' };
      cell.font = { size: 10 };
      if (rowIndex % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } };
    });
  });

  if (report.totalsRow) {
    const totalsRow = sheet.getRow(7 + report.rows.length);
    report.columns.forEach((column, index) => {
      const cell = totalsRow.getCell(index + 1);
      const raw = report.totalsRow![column.key];
      if ((column.type === 'currency' || column.type === 'number') && raw !== '' && raw !== null && raw !== undefined) {
        cell.value = Number(raw);
        cell.numFmt = '#,##0.00';
      } else {
        cell.value = raw === null || raw === undefined ? '' : String(raw);
      }
      cell.font = { bold: true, size: 10, color: { argb: 'FF1B2232' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      cell.alignment = { horizontal: column.align ?? 'left' };
      cell.border = { top: { style: 'thin', color: { argb: 'FF0866FF' } } };
    });
  }

  report.columns.forEach((column, index) => {
    const longest = report.rows.reduce(
      (max, row) => Math.max(max, cellValue(column, row[column.key], locale).length),
      column.label.length,
    );
    sheet.getColumn(index + 1).width = Math.min(42, Math.max(12, longest + 3));
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Landscape PDF with a repeating header row; Mukta renders Marathi and English alike. */
export function toPdf(report: ReportResult, organizationName: string, locale: Locale = 'en'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('body', PDF_FONTS.regular);
    doc.registerFont('bold', PDF_FONTS.bold);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    const weights = report.columns.map((column) =>
      column.type === 'text' ? (column.key === 'particulars' ? 2.2 : 1.4) : 1,
    );
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((weight) => (weight / weightSum) * width);
    const positions = widths.reduce<number[]>((acc, _w, index) => {
      acc.push(index === 0 ? left : acc[index - 1] + widths[index - 1]);
      return acc;
    }, []);

    function drawHeaderBand() {
      doc.rect(0, 0, doc.page.width, 68).fill(BRAND);
      doc.fillColor('#FFFFFF').font('bold').fontSize(14).text(organizationName, left, 14, { width: width * 0.6 });
      doc.font('body').fontSize(10).fillColor('#D6EBE3').text(report.name, left, 38, { width: width * 0.6 });
      doc
        .fontSize(9)
        .text(`${formatDateFor(locale, report.period.from)} — ${formatDateFor(locale, report.period.to)}`, left, 38, {
          width,
          align: 'right',
        });
      doc
        .fontSize(8)
        .text(`${tr(locale, 'Generated')} ${formatDateFor(locale, report.generatedAt, true)}`, left, 16, {
          width,
          align: 'right',
        });
    }

    function drawTableHeader(y: number): number {
      doc.font('bold').fontSize(8).fillColor(MUTED);
      report.columns.forEach((column, index) => {
        doc.text(locale === 'mr' ? column.label : column.label.toUpperCase(), positions[index] + 2, y, {
          width: widths[index] - 4,
          align: column.align ?? 'left',
          lineBreak: false,
        });
      });
      const lineY = y + 14;
      doc.moveTo(left, lineY).lineTo(right, lineY).strokeColor(LINE).lineWidth(1).stroke();
      return lineY + 6;
    }

    drawHeaderBand();
    let y = 84;

    const filterText = Object.entries(report.filtersApplied)
      .map(([key, value]) => `${key}: ${value}`)
      .join('   •   ');
    if (filterText) {
      doc.font('body').fontSize(8.5).fillColor(MUTED).text(filterText, left, y);
      y += 16;
    }

    if (report.summary.length) {
      const chipWidth = Math.min(180, width / report.summary.length - 8);
      report.summary.forEach((item, index) => {
        const x = left + index * (chipWidth + 8);
        doc.roundedRect(x, y, chipWidth, 38, 5).fillAndStroke('#EFF6FF', LINE);
        doc.font('body').fontSize(8).fillColor(MUTED).text(item.label, x + 8, y + 4, { width: chipWidth - 16, lineBreak: false });
        doc
          .font('bold')
          .fontSize(11)
          .fillColor(INK)
          .text(
            item.type === 'currency' ? formatINR(item.value) : item.type === 'percent' ? `${item.value}%` : String(item.value),
            x + 8,
            y + 18,
            { width: chipWidth - 16, lineBreak: false },
          );
      });
      y += 50;
    }

    y = drawTableHeader(y);
    const bottomLimit = doc.page.height - 50;
    doc.font('body').fontSize(8.5).fillColor(INK);

    for (const row of report.rows) {
      if (y > bottomLimit) {
        doc.addPage();
        drawHeaderBand();
        y = drawTableHeader(84);
        doc.font('body').fontSize(8.5).fillColor(INK);
      }
      report.columns.forEach((column, index) => {
        doc.text(cellValue(column, row[column.key], locale), positions[index] + 2, y, {
          width: widths[index] - 4,
          align: column.align ?? 'left',
          lineBreak: false,
          ellipsis: true,
        });
      });
      y += 15;
    }

    if (report.totalsRow) {
      if (y > bottomLimit - 16) {
        doc.addPage();
        drawHeaderBand();
        y = drawTableHeader(84);
      }
      doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor('#0866FF').lineWidth(1).stroke();
      doc.font('bold').fontSize(8.5).fillColor(INK);
      report.columns.forEach((column, index) => {
        doc.text(cellValue(column, report.totalsRow![column.key], locale), positions[index] + 2, y + 2, {
          width: widths[index] - 4,
          align: column.align ?? 'left',
          lineBreak: false,
        });
      });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .font('body')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `${organizationName} • ${report.name} • ${tr(locale, 'Page')} ${i + 1} ${tr(locale, 'of')} ${range.count}`,
          left,
          doc.page.height - 34,
          { width, align: 'center', lineBreak: false },
        );
    }

    doc.end();
  });
}
