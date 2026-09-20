// This module is a thin re-export shim over src/lib/korapay.ts. The
// wallet-funding/payout/identity provider was switched back from Payvessel
// to Korapay (Sept 2026) -- rather than rename every import across
// Register.tsx, FundWallet.tsx, SendMoney, Transactions.tsx etc. back to
// "korapay", this file keeps the `payvessel` module name/API surface as the
// stable call-site contract and just forwards everything to the real
// Korapay implementation. See src/lib/korapay.ts for the actual logic and
// the supabase/functions/korapay-* edge functions for the real Kora API
// calls (endpoints/shapes confirmed against developers.korapay.com, not
// guessed).
import type { KorapayAccount } from "../types";
import {
  createAccount as createKorapayAccount,
  getMyAccount as getMyKorapayAccount,
  verifyBvn as verifyKorapayBvn,
  verifyNin as verifyKorapayNin,
  listBanks as listKorapayBanks,
  resolveAccount as resolveKorapayAccount,
  checkTransferStatus as checkKorapayTransferStatus,
  payoutToBank as payoutKorapayToBank,
  type KorapayBank,
  type BankPayoutInput as KorapayBankPayoutInput,
  type BankPayoutResult as KorapayBankPayoutResult,
} from "./korapay";

export type PayvesselAccount = KorapayAccount;
export type PayvesselBank = KorapayBank;
export type BankPayoutInput = KorapayBankPayoutInput;
export type BankPayoutResult = KorapayBankPayoutResult;

export interface CreatePayvesselAccountInput {
  bvn: string;
  nin?: string;
}

export async function getMyAccount(): Promise<PayvesselAccount | null> {
  return getMyKorapayAccount();
}

export async function createAccount(input: CreatePayvesselAccountInput): Promise<PayvesselAccount> {
  return createKorapayAccount(input);
}

export interface VerifyBvnInput {
  bvn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: "MALE" | "FEMALE";
  birthday: string;
  phone: string;
}

export interface VerifyBvnResult {
  verified: boolean;
  reason?: string;
  matchPercentage?: number | null;
  phoneWarning?: string | null;
}

export interface VerifyNinInput {
  nin: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: "MALE" | "FEMALE";
  birthday: string;
  phone: string;
}

export type VerifyNinResult = VerifyBvnResult;

export async function verifyBvn(input: VerifyBvnInput): Promise<VerifyBvnResult> {
  return verifyKorapayBvn(input);
}

export async function verifyNin(input: VerifyNinInput): Promise<VerifyNinResult> {
  return verifyKorapayNin(input);
}

export async function listBanks(): Promise<PayvesselBank[]> {
  return listKorapayBanks();
}

export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string> {
  return resolveKorapayAccount(bankCode, accountNumber);
}

export async function checkTransferStatus(reference: string): Promise<"pending" | "successful" | "failed"> {
  return checkKorapayTransferStatus(reference);
}

export async function payoutToBank(input: BankPayoutInput): Promise<BankPayoutResult> {
  return payoutKorapayToBank(input);
}
