/**
 * Starter templates for an ashram: ready-made wording, in Marathi and English,
 * that opens in the template form to be adjusted and submitted to Meta.
 *
 * Variables are {{1}}, {{2}} … in the order the example values list them, and no
 * text starts or ends with one, which Meta rejects. Titles and descriptions
 * live in the translation catalog under `whatsapp.templates.gallery.<id>`.
 */
export type GalleryLanguage = 'mr' | 'en';

export interface GalleryTemplate {
  id: string;
  /** Meta name: lowercase letters, digits and underscores. */
  name: string;
  category: 'UTILITY' | 'MARKETING';
  texts: Record<GalleryLanguage, { body: string; examples: string[]; footer?: string }>;
}

export const TEMPLATE_GALLERY: GalleryTemplate[] = [
  {
    id: 'donationThanks',
    name: 'donation_thank_you',
    category: 'UTILITY',
    texts: {
      mr: {
        body: 'नमस्कार {{1}}, आपल्या {{2}} च्या देणगीबद्दल मनःपूर्वक धन्यवाद. आपल्या सेवेस फळ लाभो.',
        examples: ['रमेश', '₹5,000'],
        footer: 'आश्रम परिवार',
      },
      en: {
        body: 'Namaskar {{1}}, thank you for your kind donation of {{2}}. May your seva bear fruit.',
        examples: ['Ramesh', 'Rs. 5,000'],
        footer: 'Ashram family',
      },
    },
  },
  {
    id: 'receiptReady',
    name: 'donation_receipt_ready',
    category: 'UTILITY',
    texts: {
      mr: {
        body: 'नमस्कार {{1}}, आपल्या {{2}} च्या देणगीची पावती तयार आहे. कृपया आश्रम कार्यालयातून घ्यावी.',
        examples: ['रमेश', '₹5,000'],
      },
      en: {
        body: 'Namaskar {{1}}, the receipt for your donation of {{2}} is ready. Please collect it from the ashram office.',
        examples: ['Ramesh', 'Rs. 5,000'],
      },
    },
  },
  {
    id: 'eventInvitation',
    name: 'event_invitation',
    category: 'MARKETING',
    texts: {
      mr: {
        body: 'नमस्कार {{1}}, आश्रमात {{2}} रोजी {{3}} चे आयोजन केले आहे. आपण अवश्य उपस्थित राहावे.',
        examples: ['रमेश', '12 ऑक्टोबर', 'सत्संग'],
        footer: 'आश्रम परिवार',
      },
      en: {
        body: 'Namaskar {{1}}, we are holding {{2}} at the ashram on {{3}}. You are warmly invited to attend.',
        examples: ['Ramesh', 'a satsang', '12 October'],
        footer: 'Ashram family',
      },
    },
  },
  {
    id: 'eventReminder',
    name: 'event_reminder',
    category: 'UTILITY',
    texts: {
      mr: {
        body: 'नमस्कार {{1}}, आठवण: {{2}} रोजी {{3}} आहे. आपले स्वागत आहे.',
        examples: ['रमेश', 'उद्या', 'गुरुपौर्णिमा उत्सव'],
      },
      en: {
        body: 'Namaskar {{1}}, a reminder: {{2}} is on {{3}}. You are most welcome.',
        examples: ['Ramesh', 'the Gurupurnima celebration', 'tomorrow'],
      },
    },
  },
  {
    id: 'festivalGreeting',
    name: 'festival_greeting',
    category: 'MARKETING',
    texts: {
      mr: {
        body: 'नमस्कार {{1}}, आपणास आणि आपल्या कुटुंबास {{2}} च्या हार्दिक शुभेच्छा!',
        examples: ['रमेश', 'दिवाळी'],
        footer: 'आश्रम परिवार',
      },
      en: {
        body: 'Namaskar {{1}}, warm wishes to you and your family on {{2}}!',
        examples: ['Ramesh', 'Diwali'],
        footer: 'Ashram family',
      },
    },
  },
  {
    id: 'donationAppeal',
    name: 'donation_appeal',
    category: 'MARKETING',
    texts: {
      mr: {
        body: 'नमस्कार {{1}}, {{2}} साठी आपल्या सहकार्याची विनंती आहे. आपले छोटे दान मोठा बदल घडवते. अधिक माहितीसाठी आश्रमाशी संपर्क साधा.',
        examples: ['रमेश', 'गोशाळेच्या नूतनीकरणा'],
      },
      en: {
        body: 'Namaskar {{1}}, we request your support for {{2}}. Even a small gift makes a big difference. Please contact the ashram for details.',
        examples: ['Ramesh', 'the gaushala renovation'],
      },
    },
  },
  {
    id: 'volunteerThanks',
    name: 'volunteer_thanks',
    category: 'UTILITY',
    texts: {
      mr: {
        body: 'नमस्कार {{1}}, {{2}} मध्ये आपल्या सेवेबद्दल धन्यवाद. आपला वेळ आणि श्रम अमूल्य आहेत.',
        examples: ['रमेश', 'अन्नदान सेवा'],
      },
      en: {
        body: 'Namaskar {{1}}, thank you for your seva during {{2}}. Your time and effort are invaluable.',
        examples: ['Ramesh', 'the annadaan seva'],
      },
    },
  },
];
