import { describe, expect, it } from 'vitest';
import { WhatsAppError } from '../../src/modules/whatsapp/errors';
import {
  assertTemplateUsable,
  bodyProblem,
  buildCreatePayload,
  parameterCount,
  parseTemplate,
  renderTemplateText,
  type RawTemplate,
} from '../../src/modules/whatsapp/templates';

const raw = (overrides: Partial<RawTemplate> = {}): RawTemplate => ({
  id: '1',
  name: 'donation_thanks',
  language: 'en',
  status: 'APPROVED',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Hello {{1}}, thank you for {{2}}.' }],
  ...overrides,
});

describe('template parsing', () => {
  it('counts body variables by the highest index', () => {
    expect(parameterCount('Hi {{1}} and {{2}} and {{2}}')).toBe(2);
    expect(parameterCount('No variables')).toBe(0);
    expect(parseTemplate(raw()).bodyParameterCount).toBe(2);
  });

  it('reads header, footer and buttons', () => {
    const template = parseTemplate(
      raw({
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Thank you' },
          { type: 'BODY', text: 'Body' },
          { type: 'FOOTER', text: 'Footer' },
          { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Open', url: 'https://example.org' }, { type: 'QUICK_REPLY', text: 'Yes' }] },
        ],
      }),
    );
    expect(template).toMatchObject({ headerText: 'Thank you', footerText: 'Footer', sendable: true });
    expect(template.buttons).toEqual([
      { type: 'URL', text: 'Open', url: 'https://example.org' },
      { type: 'QUICK_REPLY', text: 'Yes' },
    ]);
  });

  it.each([
    ['location header', [{ type: 'HEADER', format: 'LOCATION' }, { type: 'BODY', text: 'x' }], undefined, 'UNSUPPORTED_HEADER'],
    ['header variable', [{ type: 'HEADER', format: 'TEXT', text: 'Hi {{1}}' }, { type: 'BODY', text: 'x' }], undefined, 'HEADER_VARIABLE'],
    ['dynamic url button', [{ type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Go', url: 'https://e.org/{{1}}' }] }], undefined, 'BUTTON_PARAMETER'],
    ['otp button', [{ type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'OTP', text: 'Copy' }] }], undefined, 'BUTTON_PARAMETER'],
    ['named parameters', [{ type: 'BODY', text: 'Hi {{name}}' }], 'NAMED', 'NAMED_PARAMETERS'],
  ])('marks a %s template as not sendable', (_label, components, parameter_format, reason) => {
    const template = parseTemplate(raw({ components, parameter_format }));
    expect(template.sendable).toBe(false);
    expect(template.unsendableReason).toBe(reason);
  });

  it('keeps the rejection reason only when there is one', () => {
    expect(parseTemplate(raw({ status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' })).rejectedReason).toBe('INVALID_FORMAT');
    expect(parseTemplate(raw({ rejected_reason: 'NONE' })).rejectedReason).toBeNull();
  });
});

describe('template use', () => {
  const template = parseTemplate(raw());

  it('fills {{n}} with the values to be sent and leaves unknown ones', () => {
    expect(renderTemplateText('Hello {{1}}, thank you for {{2}}.', ['Asha', 'your gift'])).toBe('Hello Asha, thank you for your gift.');
    expect(renderTemplateText('Hello {{1}} {{3}}', ['Asha'])).toBe('Hello Asha {{3}}');
  });

  it('accepts an approved template with every variable filled', () => {
    expect(() => assertTemplateUsable(template, ['Asha', 'your gift'])).not.toThrow();
  });

  it.each([
    ['a missing template', undefined, ['a', 'b'], 'WHATSAPP_TEMPLATE_NOT_FOUND'],
    ['a pending template', parseTemplate(raw({ status: 'PENDING' })), ['a', 'b'], 'WHATSAPP_TEMPLATE_NOT_FOUND'],
    ['an unsendable template', parseTemplate(raw({ components: [{ type: 'HEADER', format: 'LOCATION' }, { type: 'BODY', text: 'x' }] })), [], 'WHATSAPP_TEMPLATE_UNSUPPORTED'],
    ['a media header without a file', parseTemplate(raw({ components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'x' }] })), [], 'WHATSAPP_TEMPLATE_HEADER_MEDIA_REQUIRED'],
    ['too few values', template, ['a'], 'WHATSAPP_TEMPLATE_PARAMS_MISMATCH'],
    ['too many values', template, ['a', 'b', 'c'], 'WHATSAPP_TEMPLATE_PARAMS_MISMATCH'],
    ['a blank value', template, ['a', '  '], 'WHATSAPP_TEMPLATE_PARAMS_MISMATCH'],
  ])('rejects %s', (_label, subject, params, code) => {
    try {
      assertTemplateUsable(subject, params);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WhatsAppError);
      expect((error as WhatsAppError).whatsappCode).toBe(code);
    }
  });
});

describe('media headers', () => {
  const banner = parseTemplate(raw({ components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Join us' }] }));

  it('is sendable when the sender brings the file', () => {
    expect(banner).toMatchObject({ headerFormat: 'IMAGE', requiresHeaderMedia: true, sendable: true });
    expect(() => assertTemplateUsable(banner, [], { headerMedia: true })).not.toThrow();
  });

  it('keeps a text header out of the media rules', () => {
    const text = parseTemplate(raw({ components: [{ type: 'HEADER', format: 'TEXT', text: 'Hi' }, { type: 'BODY', text: 'x' }] }));
    expect(text).toMatchObject({ headerFormat: 'TEXT', requiresHeaderMedia: false });
  });

  it('submits an uploaded sample handle as the header example', () => {
    const payload = buildCreatePayload({
      name: 'banner',
      language: 'en',
      category: 'MARKETING',
      headerFormat: 'IMAGE',
      headerHandle: '4::aW1hZ2U',
      headerText: 'ignored',
      bodyText: 'Join us',
      bodyExamples: [],
      buttons: [],
    });
    expect(payload.components[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::aW1hZ2U'] } });
  });
});

describe('creating a template', () => {
  it('flags gaps and variables at either end of the body', () => {
    expect(bodyProblem('Hello {{1}}, see {{3}} now')).toBe('GAPS');
    expect(bodyProblem('{{1}} is here')).toBe('EDGE');
    expect(bodyProblem('Thanks {{1}}')).toBe('EDGE');
    expect(bodyProblem('Hello {{1}}, thanks for {{2}} today')).toBeNull();
    expect(bodyProblem('Plain text')).toBeNull();
  });

  it('builds Meta payload components in order, with examples only when there are variables', () => {
    const payload = buildCreatePayload({
      name: 'event_invite',
      language: 'mr',
      category: 'MARKETING',
      headerText: ' Invitation ',
      bodyText: 'Dear {{1}}, join us on {{2}} at the ashram.',
      bodyExamples: ['Asha', '12 Oct'],
      footerText: 'Ashram',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Yes' },
        { type: 'URL', text: 'Details', url: 'https://example.org' },
        { type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '+919876543210' },
      ],
    });
    expect(payload).toEqual({
      name: 'event_invite',
      language: 'mr',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Invitation' },
        { type: 'BODY', text: 'Dear {{1}}, join us on {{2}} at the ashram.', example: { body_text: [['Asha', '12 Oct']] } },
        { type: 'FOOTER', text: 'Ashram' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Yes' },
            { type: 'URL', text: 'Details', url: 'https://example.org' },
            { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+919876543210' },
          ],
        },
      ],
    });

    const plain = buildCreatePayload({ name: 'plain', language: 'en', category: 'UTILITY', bodyText: 'Hello', bodyExamples: [], buttons: [] });
    expect(plain.components).toEqual([{ type: 'BODY', text: 'Hello' }]);
  });
});
