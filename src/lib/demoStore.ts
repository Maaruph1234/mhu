import type { Transaction, TransactionType, Wallet } from "../types";

// A tiny in-memory store standing in for Supabase while in demo mode. Any
// module (provibill.ts, smsala.ts, Transfer.tsx, WalletContext) can read or
// mutate it without needing React context wiring. Resets on page refresh —
// this is scaffolding for clicking through the UI, not real persistence.

let wallet: Wallet = {
  balance: 42500,
  currency: "NGN",
};

let transactions: Transaction[] = [
  {
    id: "demo-seed-3",
    user_id: "demo-user",
    type: "data",
    amount: 1500,
    status: "successful",
    reference: "MHU-1002938",
    title: "2GB MTN data bundle",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "demo-seed-2",
    user_id: "demo-user",
    type: "transfer_in",
    amount: 5000,
    status: "successful",
    reference: "MHU-1002819",
    title: "Transfer received",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: "demo-seed-1",
    user_id: "demo-user",
    type: "fund_wallet",
    amount: 40000,
    status: "successful",
    reference: "MHU-1002701",
    title: "Wallet funded via bank transfer",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
  },
];

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export const demoStore = {
  getWallet: () => wallet,
  getTransactions: () => transactions,

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Adjust the wallet balance and prepend a new transaction row. */
  record(
    tx: Omit<Transaction, "id" | "created_at" | "user_id">,
    balanceDelta: number
  ) {
    wallet = {
      ...wallet,
      balance: Math.max(0, wallet.balance + balanceDelta),
    };
    transactions = [
      {
        ...tx,
        id: `local-${Date.now()}`,
        user_id: "demo-user",
        created_at: new Date().toISOString(),
      },
      ...transactions,
    ];
    emit();
  },

  reset() {
    wallet = { ...wallet, balance: 42500 };
    transactions = [];
    emit();
  },
};

export type DemoTransactionType = TransactionType;
