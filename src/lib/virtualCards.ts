import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import type { VirtualCard, VirtualCardDetail, VirtualCardTransaction } from "../types";

/**
 * Client-side wrapper around the payvessel-cards Edge Function -- USD
 * virtual card issuing (Visa/Mastercard) via Payvessel. See that function's
 * header comment for the full design reasoning (per-user isolation over a
 * shared Payvessel business account, NGN<->USD conversion at a manually
 * maintained rate, and why card_number/cvv are never persisted anywhere in
 * this app).
 */

interface CreateCardInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  bvn: string;
  nin: string;
  dob: string; // YYYY-MM-DD
  image: string; // base64 data URL of an identity document photo
  state: string;
  lga: string;
  street: string;
  postalCode: string;
  brand: "VISA" | "MASTERCARD";
  cardName?: string;
  isContactless?: boolean;
  prefundAmountUsd?: number;
}

async function invoke<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("payvessel-cards", { body: payload });
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error));
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data as T;
}

export async function listCards(): Promise<VirtualCard[]> {
  const { cards } = await invoke<{ cards: VirtualCard[] }>({ action: "list" });
  return cards;
}

export async function createCard(input: CreateCardInput): Promise<VirtualCard> {
  const { card } = await invoke<{ card: VirtualCard }>({ action: "create", ...input });
  return card;
}

export async function getCard(cardId: string, reveal = false): Promise<VirtualCardDetail> {
  const { card } = await invoke<{ card: VirtualCardDetail }>({ action: "get", cardId, reveal });
  return card;
}

export async function fundCard(cardId: string, amountUsd: number): Promise<void> {
  await invoke({ action: "fund", cardId, amountUsd });
}

export async function withdrawFromCard(cardId: string, amountUsd: number): Promise<void> {
  await invoke({ action: "withdraw", cardId, amountUsd });
}

export async function freezeCard(cardId: string): Promise<void> {
  await invoke({ action: "freeze", cardId });
}

export async function unfreezeCard(cardId: string): Promise<void> {
  await invoke({ action: "unfreeze", cardId });
}

export async function terminateCard(cardId: string): Promise<void> {
  await invoke({ action: "terminate", cardId });
}

export async function getCardTransactions(cardId: string, size = 50): Promise<VirtualCardTransaction[]> {
  const { transactions } = await invoke<{ transactions: VirtualCardTransaction[] }>({
    action: "transactions",
    cardId,
    size,
  });
  return transactions;
}
