import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import { isDemoMode } from "./demoMode";
import type { KorapayAccount } from "../types";

/**
 * Client-side wrapper around Korapay (see developers.korapay.com) -- the
 * wallet-funding rail. Every MHU Global user gets their own permanent NGN
 * Virtual Bank Account (a real dedicated account number, backed by a bank
 * like Wema/Fidelity) that they transfer money into to fund their in-app
 * wallet, exactly like the "Create Virtual Bank Account" flow documented at
 * developers.korapay.com/docs/virtual-bank-accounts-ngn.
 *
 * Two Supabase Edge Functions do the actual API talking, because Korapay's
 * secret key (sk_test_xxx / sk_live_xxx) must never reach the browser:
 *
 *   - korapay-create-account: called once per user (after they submit their
 *     BVN, which Korapay requires by regulation for KYC) to create their
 *     Virtual Bank Account via POST /merchant/api/v1/virtual-bank-account,
 *     then stores the returned account in the `korapay_accounts` table.
 *   - korapay-webhook: a public endpoint Korapay calls whenever money lands
 *     in one of those virtual accounts (event "charge.success"). It
 *     verifies the x-korapay-signature header, credits the matching user's
 *     wallet_balance, and logs a transaction. Configure its URL as your
 *     webhook URL in the Kora dashboard (API Configuration tab) -- see
 *     README.md.
 *
 * In demo mode there's no real account to fetch or create -- FundWallet.tsx
 * shows a fabricated bank account instead, so this module is simply not
 * called.
 */

export interface CreateKorapayAccountInput {
  bvn: string;
  nin?: string;
}

export async function getMyAccount(): Promise<KorapayAccount | null> {
  if (isDemoMode) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("korapay_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as KorapayAccount | null;
}

export async function createAccount(input: CreateKorapayAccountInput): Promise<KorapayAccount> {
  const { data, error } = await supabase.functions.invoke("korapay-create-account", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as KorapayAccount;
}

/**
 * BVN identity check used at registration -- the name and phone number
 * someone types on the signup form must match what Korapay's BVN Lookup API
 * (developers.korapay.com/docs/nigeria-bvn) returns for that BVN, or
 * registration is declined before an account is ever created. Called
 * *before* supabase.auth.signUp(), so this hits a public/no-JWT edge
 * function (korapay-verify-bvn) rather than one gated behind a session.
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
  const { data, error } = await supabase.functions.invoke("korapay-verify-bvn", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as VerifyBvnResult;
}

/**
 * "Transfer to bank" -- sending money OUT of the wallet to an external
 * Nigerian bank account, via Korapay's Payout API (a different product
 * from the virtual-account funding above). Routed through the
 * `korapay-payout` Edge Function for the same secret-key reasons.
 */
export interface KorapayBank {
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

export async function listBanks(): Promise<KorapayBank[]> {
  if (isDemoMode) {
    return [
      { name: "Access Bank", code: "044" },
      { name: "GTBank", code: "058" },
      { name: "UBA", code: "033" },
      { name: "Zenith Bank", code: "057" },
    ];
  }
  const { data, error } = await supabase.functions.invoke("korapay-payout", {
    body: { action: "banks" },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return (data as { banks: KorapayBank[] }).banks;
}

export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string> {
  if (isDemoMode) {
    await new Promise((r) => setTimeout(r, 500));
    return "Chidinma Okafor";
  }
  const { data, error } = await supabase.functions.invoke("korapay-payout", {
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
  const { data, error } = await supabase.functions.invoke("korapay-payout", {
    body: input,
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data as BankPayoutResult;
}
