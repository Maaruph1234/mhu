import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./AuthContext";
import { isDemoMode } from "../lib/demoMode";
import { demoStore } from "../lib/demoStore";
import type { Transaction, Wallet } from "../types";

interface WalletContextValue {
  wallet: Wallet | null;
  transactions: Transaction[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { user, profile, refreshProfile } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // There's no separate `wallets` table in the real schema — balance is
  // just `users.wallet_balance`, which AuthContext's `profile` already
  // carries. This synthesizes the `Wallet` shape the rest of the app
  // (WalletCard, Transfer, Dashboard) already expects.
  const wallet: Wallet | null = isDemoMode
    ? demoStore.getWallet()
    : profile
    ? { balance: Number(profile.wallet_balance ?? 0), currency: "NGN" }
    : null;

  const refresh = async () => {
    if (isDemoMode) {
      setTransactions(demoStore.getTransactions());
      setLoading(false);
      return;
    }
    if (!user) {
      setTransactions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [, { data: tx }] = await Promise.all([
      refreshProfile(),
      supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setTransactions((tx as Transaction[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    if (isDemoMode) {
      return demoStore.subscribe(() => {
        setTransactions(demoStore.getTransactions());
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = useMemo(() => ({ wallet, transactions, loading, refresh }), [wallet, transactions, loading]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
