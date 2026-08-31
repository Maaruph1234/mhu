import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import type { PayvesselAccount } from "../types";

/**
 * Client-side wrapper around Payvessel (see docs.payvessel.com) -- the
 * wallet-funding, identity-verification, and bank-payout provider,
 * replacing Korapay. Every MHU Global user gets their own permanent NGN
 * Virtual Bank Account (a STATIC reserved account per
 * docs.payvessel.com/accept-payment/customer-reserved-account) that they
 * transfer money into to fund their in-app wallet.
 *
 * Three Supabase Edge Functions do the actual API talking, because
 * Payvessel's api-key/api-secret pair must never reach the browser:
 *
 *   - payvessel-verify-bvn: identity check at registration (see
 *     Register.tsx) -- public/no-JWT since it runs before signup.
 *   - payvessel-create-account: called once per user (after they submit
 *     their BVN) to create their virtual account via Payvessel's
 *     Create Virtual Account API, then stores it in `payvessel_accounts`.
 *   - payvessel-webhook: a public endpoint Payvessel calls whenever money
 *     lands in one of those virtual accounts (event
 *     "reserved_account.credit"), or a bank payout resolves (event
 *     "transfer.success"/"transfer.failed"/"transfer.reversed"). Configure
 *     its URL as your webhook URL in the Payvessel dashboard.
 *   - payvessel-payout: "Transfer to bank" -- listing banks, resolving an
 *     account name, and initiating the actual payout.
 *
 * In demo mode there's no real account to fetch or create -- FundWallet.tsx
 * shows a fabricated bank account instead, so this module is simply not
 * called.
 */

export interface CreatePayvesselAccountInput {
  bvn: string;
  nin: string;
}

export async function getMyAccount(): Promise<PayvesselAccount | null> {
  if (isDemoMode) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("payvessel_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as PayvesselAccount | null;
}

export async function createAccount(input: CreatePayvesselAccountInput): Promise<PayvesselAccount> {
  const { data, error } = await supabase.functions.invoke("payvessel-create-account", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as PayvesselAccount;
}

/**
 * BVN identity check used at registration -- the name and phone number
 * someone types on the signup form must match what Payvessel's Enhanced BVN
 * Verification API (docs.payvessel.com/identity-verification/enhanced-bvn-
 * verification) returns for that BVN, or registration is declined before an
 * account is ever created. Called *before* supabase.auth.signUp(), so this
 * hits a public/no-JWT edge function (payvessel-verify-bvn) rather than one
 * gated behind a session.
 */
export interface VerifyBvnInput {
  bvn: string;
  firstName: string;
  lastName: string;
  phone: string;
}

export interface VerifyBvnResult {
  verified: boolean;
  reason?: string;
  // Present when verified: true -- the BVN record's own name/phone, used to
  // populate the new account instead of whatever was typed on the form.
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export async function verifyBvn(input: VerifyBvnInput): Promise<VerifyBvnResult> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 700));
    return { verified: true, firstName: input.firstName, lastName: input.lastName, phone: input.phone };
  }
  const { data, error } = await supabase.functions.invoke("payvessel-verify-bvn", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as VerifyBvnResult;
}

/**
 * "Transfer to bank" -- sending money OUT of the wallet to an external
 * Nigerian bank account, via Payvessel's Transfers API. Routed through the
 * `payvessel-payout` Edge Function for the same secret-key reasons.
 */
export interface PayvesselBank {
  name: string;
  code: string;
}

export interface BankPayoutInput {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  narration?: string;
}

export interface BankPayoutResult {
  success: boolean;
  reference: string;
  message: string;
}

export async function listBanks(): Promise<PayvesselBank[]> {
  if (isDemoMode) {
    return [
      { name: "Access Bank", code: "044" },
      { name: "GTBank", code: "058" },
      { name: "UBA", code: "033" },
      { name: "Zenith Bank", code: "057" },
    ];
  }
  const { data, error } = await supabase.functions.invoke("payvessel-payout", {
    body: { action: "banks" },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { banks: PayvesselBank[] }).banks;
}

export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 500));
    return "Chidinma Okafor";
  }
  const { data, error } = await supabase.functions.invoke("payvessel-payout", {
    body: { action: "resolve", bankCode, accountNumber },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { accountName: string }).accountName;
}

export async function payoutToBank(input: BankPayoutInput): Promise<BankPayoutResult> {
  if (isDemoMode) {
    const { demoStore } = await import("./demoStore");
    await new Promise((r) => setTimeout(r, 900));
    const wallet = demoStore.getWallet();
    const reference = `TRFBANK-${Date.now()}`;
    if (input.amount > wallet.balance) {
      return { success: false, reference, message: "Insufficient wallet balance" };
    }
    demoStore.record(
      {
        type: "bank_transfer_out",
        amount: input.amount,
        status: "successful",
        reference,
        title: `Bank transfer to ${input.accountName || input.accountNumber}`,
      },
      -input.amount
    );
    return { success: true, reference, message: "Bank transfer successful" };
  }
  const { data, error } = await supabase.functions.invoke("payvessel-payout", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as BankPayoutResult;
}
