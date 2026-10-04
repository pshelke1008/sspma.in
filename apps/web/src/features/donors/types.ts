import type { DonorCategoryKey, Locale } from '@ashram/types';
import type { WhatsAppMessage } from '@/features/whatsapp/api';

export interface Donor {
  id: string;
  code: string;
  name: string;
  category: DonorCategoryKey;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  alternatePhone: string | null;
  panNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  dateOfBirth: string | null;
  anniversaryDate: string | null;
  preferredLanguage: Locale;
  tags: string[];
  notes: string | null;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface DonorRow extends Donor {
  stats: { totalDonated: number; donationCount: number; lastDonationAt: string | null };
  messaging: { number: string | null; canMessage: boolean };
}

export interface DonorListResponse {
  data: DonorRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface DonorSummary {
  totalDonors: number;
  optedIn: number;
  newThisMonth: number;
  donorsWhoGave: number;
  totalDonated: number;
  tags: string[];
}

export interface DonorProfile extends Donor {
  createdBy: { id: string; name: string } | null;
  stats: {
    totalDonated: number;
    donationCount: number;
    averageDonation: number;
    firstDonationAt: string | null;
    lastDonationAt: string | null;
    byFund: { fundId: string; name: string; amount: number; count: number }[];
    byYear: { year: string; amount: number }[];
  };
  donations: {
    id: string;
    receiptNumber: string;
    date: string;
    amount: number;
    mode: string;
    purpose: string | null;
    referenceNumber: string | null;
    is80GEligible: boolean;
    fund: { id: string; name: string };
    bankAccount: { id: string; name: string } | null;
  }[];
  messages: WhatsAppMessage[];
  messaging: {
    number: string | null;
    canMessage: boolean;
    reason: 'INACTIVE' | 'NO_NUMBER' | 'NOT_OPTED_IN' | null;
  };
}
