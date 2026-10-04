import { describe, expect, it } from 'vitest';
import { isValidAadhaar, maskAadhaar } from '@ashram/types';

describe('Aadhaar numbers', () => {
  it('accepts a number whose Verhoeff check digit matches, with or without spaces', () => {
    expect(isValidAadhaar('234567890124')).toBe(true);
    expect(isValidAadhaar('2345 6789 0124')).toBe(true);
    expect(isValidAadhaar('4987-6543-2102')).toBe(true);
  });

  it('rejects typos, swapped digits and impossible numbers', () => {
    expect(isValidAadhaar('234567890125')).toBe(false); // wrong check digit
    expect(isValidAadhaar('234567809124')).toBe(false); // two digits swapped
    expect(isValidAadhaar('134567890124')).toBe(false); // cannot start with 0 or 1
    expect(isValidAadhaar('23456789012')).toBe(false); // 11 digits
    expect(isValidAadhaar('abcd56789012')).toBe(false);
  });

  it('masks all but the last four digits', () => {
    expect(maskAadhaar('234567890124')).toBe('XXXX XXXX 0124');
    expect(maskAadhaar(null)).toBeNull();
  });
});
