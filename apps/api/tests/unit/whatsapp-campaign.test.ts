import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { WhatsAppError } from '../../src/modules/whatsapp/errors';
import { assertScheduleValid, estimateCost, SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '../../src/modules/whatsapp/campaign.service';
import { buildRecipientTemplate, cellText, parseRecipientSheet } from '../../src/modules/whatsapp/recipients.upload';

async function sheetOf(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Recipients');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const codeOf = (error: unknown) => (error instanceof WhatsAppError ? error.whatsappCode : String(error));

describe('recipient spreadsheet', () => {
  it('finds the phone column and keeps the others for variables', async () => {
    const parsed = await parseRecipientSheet(
      await sheetOf([
        ['Name', 'Mobile Number', 'Amount'],
        ['Asha', '98200 11223', 5000],
        ['Ravi', '+91 98765 12345', 1200],
      ]),
    );
    expect(parsed.columns).toEqual(['Name', 'Mobile Number', 'Amount']);
    expect(parsed.phoneColumn).toBe('Mobile Number');
    expect(parsed.rows.map((row) => row.phone)).toEqual(['919820011223', '919876512345']);
    expect(parsed.rows[0].values).toEqual({ Name: 'Asha', 'Mobile Number': '98200 11223', Amount: '5000' });
  });

  it('reads phone numbers typed as numbers, and skips blank lines', async () => {
    const parsed = await parseRecipientSheet(await sheetOf([['Phone'], [9820011223], [], [null], ['abc']]));
    expect(parsed.rows.map((row) => row.phone)).toEqual(['919820011223', null]);
    expect(parsed.rows[1].rowNumber).toBe(5);
  });

  it('starts at the first row that has anything in it', async () => {
    const parsed = await parseRecipientSheet(await sheetOf([[], [], ['Phone', 'Name'], ['9820011223', 'Asha']]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].values.Name).toBe('Asha');
  });

  it('keeps repeated headers addressable', async () => {
    const parsed = await parseRecipientSheet(await sheetOf([['Phone', 'Date', 'Date'], ['9820011223', '1', '2']]));
    expect(parsed.columns).toEqual(['Phone', 'Date', 'Date (2)']);
  });

  it('formats dates the way a person reads them', () => {
    expect(cellText(new Date(Date.UTC(2026, 9, 4)))).toBe('04-10-2026');
    expect(cellText({ richText: [{ text: 'Hello ' }, { text: 'there' }] })).toBe('Hello there');
    expect(cellText({ formula: 'A1', result: 7 })).toBe('7');
    expect(cellText(null)).toBe('');
  });

  it('refuses a sheet without a phone column, and a file that is not a spreadsheet', async () => {
    await expect(parseRecipientSheet(await sheetOf([['Name', 'City'], ['Asha', 'Pune']]))).rejects.toSatisfy(
      (error) => codeOf(error) === 'WHATSAPP_UPLOAD_INVALID',
    );
    await expect(parseRecipientSheet(Buffer.from('not,a,spreadsheet'))).rejects.toSatisfy(
      (error) => codeOf(error) === 'WHATSAPP_UPLOAD_INVALID',
    );
  });

  it('offers an example with a column per variable', async () => {
    const parsed = await parseRecipientSheet(await buildRecipientTemplate(2));
    expect(parsed.columns).toEqual(['Phone', 'Name', 'Variable 1', 'Variable 2']);
    expect(parsed.rows).toHaveLength(1);
  });
});

describe('broadcast scheduling', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms);

  it('allows a time a few minutes to a month away, or no time at all', () => {
    expect(() => assertScheduleValid(null, now)).not.toThrow();
    expect(() => assertScheduleValid(undefined, now)).not.toThrow();
    expect(() => assertScheduleValid(at(SCHEDULE_MIN_LEAD_MS + 1000), now)).not.toThrow();
    expect(() => assertScheduleValid(at(SCHEDULE_MAX_LEAD_MS - 1000), now)).not.toThrow();
  });

  it.each([
    ['in the past', -60_000],
    ['right now', 0],
    ['too soon', SCHEDULE_MIN_LEAD_MS - 1000],
    ['too far ahead', SCHEDULE_MAX_LEAD_MS + 1000],
  ])('refuses a time %s', (_label, offset) => {
    expect(() => assertScheduleValid(at(offset), now)).toThrow(WhatsAppError);
  });

  it('refuses an invalid date', () => {
    expect(() => assertScheduleValid(new Date('nonsense'), now)).toThrow(WhatsAppError);
  });
});

describe('cost estimate', () => {
  it('prices by category, with GST, rounded to paise', () => {
    expect(estimateCost('MARKETING', 100)).toBe(92.04);
    expect(estimateCost('UTILITY', 1000)).toBe(135.7);
    expect(estimateCost('MARKETING', 0)).toBe(0);
  });

  it('treats an unknown category as marketing, the dearest', () => {
    expect(estimateCost('SOMETHING_NEW', 100)).toBe(estimateCost('MARKETING', 100));
  });
});
