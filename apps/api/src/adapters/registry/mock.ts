/**
 * Mock registries — DEMO DATA ONLY, and labelled so everywhere it surfaces (Judge Mode reports
 * `mode: 'mock'`; every verification row records `adapter_mode`).
 *
 * The shape follows Phase 1's GOV_FARMER_REGISTRY — a small bundled sample standing in for a
 * real lookup — reseeded for Maharashtra (PROMPT §16.1). The mocks behave like the real service:
 * unknown identifiers return nothing, cancelled registrations say so, and identifiers are
 * matched after the same normalisation a registry would apply.
 */
import { gstinCheckChar, type BusinessIdKind, type BusinessRecord, type BuyerRegistryAdapter, type FarmerRecord, type FarmerRegistry, type FarmerRegistryAdapter } from './types.js';

export const MOCK_FARMERS: readonly FarmerRecord[] = [
  { registry: 'pm-kisan', id: 'PMK-MH-2003-11427', name: 'Sunil Ramrao Bhosale', district: 'nashik', village: 'Vinchur (Niphad)' },
  { registry: 'pm-kisan', id: 'PMK-MH-2003-11562', name: 'Sangita Dnyaneshwar Kadam', district: 'nashik', village: 'Lasalgaon' },
  { registry: 'pm-kisan', id: 'PMK-MH-2003-11873', name: 'Dattatray Sopan Jadhav', district: 'nashik', village: 'Pimpalgaon Baswant' },
  { registry: 'pm-kisan', id: 'PMK-MH-2003-12004', name: 'Rekha Sanjay Pawar', district: 'nashik', village: 'Niphad' },
  { registry: 'pm-kisan', id: 'PMK-MH-2003-12115', name: 'Ganesh Narayan Shinde', district: 'nashik', village: 'Niphad' },
  { registry: 'pm-kisan', id: 'PMK-MH-2211-07314', name: 'Balasaheb Vitthal Shinde', district: 'latur', village: 'Ausa' },
  { registry: 'pm-kisan', id: 'PMK-MH-2211-07588', name: 'Shobha Ramdas More', district: 'latur', village: 'Nilanga' },
  { registry: 'pm-kisan', id: 'PMK-MH-1911-04420', name: 'Kishor Namdeo Patil', district: 'jalgaon', village: 'Raver' },
  { registry: 'pm-kisan', id: 'PMK-MH-2505-03318', name: 'Vinod Keshavrao Thakre', district: 'nagpur', village: 'Katol' },
  { registry: 'pm-kisan', id: 'PMK-MH-2106-08872', name: 'Prakash Baban Gaikwad', district: 'pune', village: 'Narayangaon' },
  { registry: 'pm-kisan', id: 'PMK-MH-2311-05519', name: 'Anil Tukaram Kale', district: 'ahilyanagar', village: 'Rahuri' },
  { registry: 'agristack', id: '27010203045', name: 'Sunita Arjun Pawar', district: 'nashik', village: 'Niphad' },
];

function gstin(first14: string): string {
  return first14 + gstinCheckChar(first14);
}

export const MOCK_BUSINESSES: readonly BusinessRecord[] = [
  { method: 'gstin', id: gstin('27AAKFG4821H1Z'), legalName: 'Godavari Agro Traders', status: 'active', district: 'nashik' },
  { method: 'gstin', id: gstin('27AADCD7390K1Z'), legalName: 'Deccan Exports Private Limited', status: 'active', district: 'nashik' },
  { method: 'gstin', id: gstin('27AAHFN5512M1Z'), legalName: 'Niphad Traders', status: 'active', district: 'nashik' },
  { method: 'gstin', id: gstin('27AAECS1128P1Z'), legalName: 'Sahyadri Fresh Foods Private Limited', status: 'active', district: 'nashik' },
  { method: 'gstin', id: gstin('27AAAFL6203Q1Z'), legalName: 'Latur Dal Mills', status: 'active', district: 'latur' },
  { method: 'gstin', id: gstin('27AABFK9914R1Z'), legalName: 'Kalyan Commission Agents', status: 'cancelled', district: 'nashik' },
  { method: 'udyam', id: 'UDYAM-MH-26-0012345', legalName: 'Shree Sai Onion Traders', status: 'active', district: 'nashik' },
  { method: 'udyam', id: 'UDYAM-MH-18-0045210', legalName: 'Jalgaon Banana Growers Supply', status: 'active', district: 'jalgaon' },
];

export class MockFarmerRegistryAdapter implements FarmerRegistryAdapter {
  readonly mode = 'mock' as const;

  constructor(private readonly records: readonly FarmerRecord[] = MOCK_FARMERS) {}

  async lookup(registry: FarmerRegistry, id: string): Promise<FarmerRecord | null> {
    const wanted = id.trim().toUpperCase();
    return this.records.find((r) => r.registry === registry && r.id.toUpperCase() === wanted) ?? null;
  }
}

export class MockBuyerRegistryAdapter implements BuyerRegistryAdapter {
  readonly mode = 'mock' as const;

  constructor(private readonly records: readonly BusinessRecord[] = MOCK_BUSINESSES) {}

  async lookup(method: BusinessIdKind, id: string): Promise<BusinessRecord | null> {
    const wanted = id.trim().toUpperCase();
    return this.records.find((r) => r.method === method && r.id.toUpperCase() === wanted) ?? null;
  }
}
