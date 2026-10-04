import { describe, expect, it } from 'vitest';
import {
  ImportFileError,
  TEMPLATE_COLUMNS,
  decodeCsv,
  detectDuplicates,
  parseCsv,
  parseDonorCsv,
  templateCsv,
  type ExistingDonorRef,
} from '../../src/modules/donors/donor.import.parse';

describe('CSV parser', () => {
  it('splits plain records on commas and line breaks', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('accepts CRLF and lone CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4\r5,6')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('strips a leading byte-order mark', () => {
    expect(parseCsv('﻿name,city\nRam,Pune')[0]).toEqual(['name', 'city']);
  });

  it('keeps commas, escaped quotes and line breaks inside quoted fields', () => {
    expect(parseCsv('name,notes\n"Patil, Ramesh","He said ""Om""\r\nthen left"\n')).toEqual([
      ['name', 'notes'],
      ['Patil, Ramesh', 'He said "Om"\r\nthen left'],
    ]);
  });

  it('keeps empty fields, including trailing ones', () => {
    expect(parseCsv('a,,c,\n')).toEqual([['a', '', 'c', '']]);
    expect(parseCsv('""\n')).toEqual([['']]);
  });

  it('handles Marathi text', () => {
    expect(parseCsv('name\nरमेश पाटील\n')).toEqual([['name'], ['रमेश पाटील']]);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('name\n"Ramesh')).toThrow(ImportFileError);
  });
});

describe('UTF-8 decoding', () => {
  it('decodes UTF-8 and drops the BOM', () => {
    const bytes = new TextEncoder().encode('﻿name\nरमेश');
    expect(decodeCsv(bytes)).toBe('name\nरमेश');
  });

  it('rejects bytes that are not UTF-8', () => {
    expect(() => decodeCsv(new Uint8Array([0x6e, 0x61, 0xe9, 0x0a]))).toThrow(/UTF-8/);
  });
});

describe('donor CSV mapping', () => {
  const header = TEMPLATE_COLUMNS.join(',');

  it('produces a template whose header round-trips', () => {
    const parsed = parseCsv(templateCsv());
    expect(parsed).toEqual([[...TEMPLATE_COLUMNS]]);
  });

  it('maps a full row onto the donor schema', () => {
    const csv = `${header}\nRamesh Patil,family,98200 11223,,r@example.com,abcde1234f,1 Main Rd,,Maharashtra,Pune,Hadapsar,411005,Marathi,annadaan; monthly ;annadaan,Note,yes\n`;
    const { rows } = parseDonorCsv(csv);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.rowNumber).toBe(2);
    expect(row.errors).toEqual([]);
    expect(row.data).toMatchObject({
      name: 'Ramesh Patil',
      category: 'FAMILY',
      phone: '98200 11223',
      panNumber: 'ABCDE1234F',
      preferredLanguage: 'mr',
      tags: ['annadaan', 'monthly'],
      whatsappOptIn: true,
      state: 'Maharashtra',
      district: 'Pune',
      village: 'Hadapsar',
    });
    expect(row.provided).not.toContain('whatsappNumber');
  });

  it('applies schema defaults to blank optional columns', () => {
    const { rows } = parseDonorCsv('name,phone\nSita Devi,\n');
    expect(rows[0].data).toMatchObject({ category: 'INDIVIDUAL', preferredLanguage: 'mr', whatsappOptIn: false, tags: [] });
  });

  it('reads City as the district and Gaon or Marathi headers as the village', () => {
    expect(parseDonorCsv('name,City,Gaon\nRam,Satara,Wai\n').columns).toEqual(['name', 'district', 'village']);
    const { rows, columns } = parseDonorCsv('नाव,राज्य,जिल्हा,गाव\nराम,महाराष्ट्र,सातारा,वाई\n');
    expect(columns).toEqual(['name', 'state', 'district', 'village']);
    expect(rows[0].data).toMatchObject({ state: 'महाराष्ट्र', district: 'सातारा', village: 'वाई' });
  });

  it('understands friendly header spellings', () => {
    const { rows, columns } = parseDonorCsv('Donor Name,Mobile,WhatsApp Number,PAN,Pincode\nRam,9820011223,,,411001\n');
    expect(columns).toEqual(['name', 'phone', 'whatsappNumber', 'panNumber', 'postalCode']);
    expect(rows[0].data?.phone).toBe('9820011223');
  });

  it('reports field errors with codes and keeps the row out of the import', () => {
    const csv = 'name,phone,panNumber,email,category,whatsappOptIn,preferredLanguage\nR,123,BAD,nope,ALIEN,maybe,fr\n';
    const [row] = parseDonorCsv(csv).rows;
    expect(row.data).toBeNull();
    const codes = Object.fromEntries(row.errors.map((error) => [error.field, error.code]));
    expect(codes).toEqual({
      name: 'NAME_REQUIRED',
      phone: 'INVALID_PHONE',
      panNumber: 'INVALID_PAN',
      email: 'INVALID_EMAIL',
      category: 'INVALID_CATEGORY',
      whatsappOptIn: 'INVALID_OPT_IN',
      preferredLanguage: 'INVALID_LANGUAGE',
    });
  });

  it('skips blank lines but keeps spreadsheet row numbers', () => {
    const { rows } = parseDonorCsv('name\nRam\n,\n\nSita\n');
    expect(rows.map((row) => [row.rowNumber, row.data?.name])).toEqual([
      [2, 'Ram'],
      [5, 'Sita'],
    ]);
  });

  it('lists columns it does not recognise', () => {
    expect(parseDonorCsv('name,favourite colour\nRam,blue\n').unknownColumns).toEqual(['favourite colour']);
  });

  it('rejects files without a name column, without rows, or over the row cap', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as ImportFileError).code;
      }
      return null;
    };
    expect(code(() => parseDonorCsv('phone\n9820011223\n'))).toBe('IMPORT_NO_NAME_COLUMN');
    expect(code(() => parseDonorCsv('name\n'))).toBe('IMPORT_EMPTY');
    expect(code(() => parseDonorCsv(''))).toBe('IMPORT_EMPTY');
    expect(code(() => parseDonorCsv('name\nA1\nB1\nC1\n', 2))).toBe('IMPORT_TOO_MANY_ROWS');
  });
});

describe('duplicate detection', () => {
  const existing: ExistingDonorRef[] = [
    { id: 'd1', code: 'DNR-00001', name: 'Ramesh Patil', phone: '+91 98200 11223', whatsappNumber: null, panNumber: 'ABCDE1234F' },
    { id: 'd2', code: 'DNR-00002', name: 'Sita Devi', phone: null, whatsappNumber: '09876543210', panNumber: null, isActive: false },
  ];

  function detect(csv: string) {
    const { rows } = parseDonorCsv(csv);
    return detectDuplicates(rows, existing);
  }

  it('matches an existing donor by normalized phone', () => {
    const matches = detect('name,phone\nRamesh,9820011223\n');
    expect(matches.get(2)).toEqual({
      source: 'existing',
      field: 'phone',
      donorId: 'd1',
      code: 'DNR-00001',
      name: 'Ramesh Patil',
      isActive: true,
    });
  });

  it("compares a row's phone against existing WhatsApp numbers and vice versa", () => {
    expect(detect('name,phone\nSita,9876543210\n').get(2)).toMatchObject({ donorId: 'd2', isActive: false });
    expect(detect('name,whatsappNumber\nRamesh,+919820011223\n').get(2)).toMatchObject({ donorId: 'd1' });
  });

  it('matches an existing donor by PAN regardless of case', () => {
    expect(detect('name,panNumber\nR Patil,abcde1234f\n').get(2)).toMatchObject({ source: 'existing', field: 'pan', donorId: 'd1' });
  });

  it('matches earlier rows in the same file', () => {
    const matches = detect('name,phone,panNumber\nAsha,9000000001,\nAsha K,+91 90000 00001,\nVijay,,PQRST6789Z\nVijay S,,pqrst6789z\n');
    expect(matches.get(2)).toBeUndefined();
    expect(matches.get(3)).toEqual({ source: 'file', field: 'phone', rowNumber: 2 });
    expect(matches.get(4)).toBeUndefined();
    expect(matches.get(5)).toEqual({ source: 'file', field: 'pan', rowNumber: 4 });
  });

  it('lets only one row claim an existing donor', () => {
    // Row 2 matches d1 by phone; row 3 matches d1 only by PAN.
    const matches = detect('name,phone,panNumber\nRamesh,9820011223,\nR Patil,,ABCDE1234F\n');
    expect(matches.get(2)).toMatchObject({ source: 'existing', donorId: 'd1' });
    expect(matches.get(3)).toEqual({ source: 'file', field: 'pan', rowNumber: 2 });
  });

  it('ignores invalid rows and rows without a phone or PAN', () => {
    const matches = detect('name,phone\nX,123\nNew Person,\nAnother,9000000002\n');
    expect(matches.size).toBe(0);
  });
});
