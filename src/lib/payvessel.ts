// This module is a thin re-export shim, kept so existing imports across
// Transfer.tsx, Transactions.tsx etc. don't need to change every time the
// underlying provider does. listBanks/resolveAccount/checkTransferStatus/
// payoutToBank ("Send to Bank") forward to Xpress Wallet
// (src/lib/xpressWallet.ts) -- switched back from Korapay, Sept 2026,
// alongside wallet funding.
//
// REMOVED Sept 2026: verifyBvn/verifyNin (identity verification at signup)
// used to live here, calling Payvessel's real Basic NIN/BVN Verification
// product directly. Payvessel has been removed from this app entirely
// (Virtual Cards, extra-document identity verification, and this signup
// check were its last remaining features) -- there is no longer any
// identity-verification gate at signup. The only identity check left
// anywhere is Xpress Wallet's own BVN validation, done as a side effect of
// creating a wallet account (see xpresswallet-create-wallet). See
// README.md's "Payvessel" and "Korapay" sections for the full history.
import {
  listBanks as listXpressWalletBanks,
  resolveAccount as resolveXpressWalletAccount,
  checkTransferStatus as checkXpressWalletTransferStatus,
  payoutToBank as payoutXpressWalletToBank,
  type XpressWalletBank,
  type BankPayoutInput as XpressWalletBankPayoutInput,
  type BankPayoutResult as XpressWalletBankPayoutResult,
} from "./xpressWallet";

export type PayvesselBank = XpressWalletBank;
export type BankPayoutInput = XpressWalletBankPayoutInput;
export type BankPayoutResult = XpressWalletBankPayoutResult;

export async function listBanks(): Promise<PayvesselBank[]> {
  return listXpressWalletBanks();
}

export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string> {
  return resolveXpressWalletAccount(bankCode, accountNumber);
}

export async function checkTransferStatus(reference: string): Promise<"pending" | "successful" | "failed"> {
  return checkXpressWalletTransferStatus(reference);
}

export async function payoutToBank(input: BankPayoutInput): Promise<BankPayoutResult> {
  return payoutXpressWalletToBank(input);
}
