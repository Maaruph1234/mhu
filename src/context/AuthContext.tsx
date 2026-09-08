import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, extractFunctionErrorMessage } from "../lib/supabaseClient";
import { isDemoMode } from "../lib/demoMode";
import { DEMO_PROFILE } from "../lib/demoProfile";
import type { Profile } from "../types";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (input: { fullName: string; email: string; phone: string; password: string; referredBy?: string }) => Promise<{ error?: string; needsVerification?: boolean; userId?: string }>;
  sendSignupOtp: (input: { userId: string; email: string; phone: string; channel: "email" | "sms" }) => Promise<{ error?: string }>;
  verifySignupOtp: (input: { userId: string; code: string; email: string; password: string }) => Promise<{ error?: string }>;
  signIn: (input: { email: string; password: string }) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, "display_name">>) => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Demo mode uses a minimal fake User/Session shape — enough for the rest of
// the app (which only reads `user.id` / `user.email`), without needing a
// real Supabase auth session.
const DEMO_USER = { id: DEMO_PROFILE.id, email: DEMO_PROFILE.email } as unknown as User;
const DEMO_SESSION = { user: DEMO_USER } as unknown as Session;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(!isDemoMode);

  // Table is `users` (the real production table the Flutter app already
  // uses), not `profiles`. See src/types/index.ts for the column mapping.
  // If the row doesn't exist yet for a just-confirmed signup (no DB trigger,
  // or the trigger hasn't landed), create it from the auth user's metadata
  // (full_name/phone were stashed there at signUp time) as a safety net.
  const loadOrCreateProfile = async (authUser: User) => {
    const { data } = await supabase.from("users").select("*").eq("id", authUser.id).single();
    if (data) {
      setProfile(data as Profile);
      return;
    }
    const meta = (authUser.user_metadata ?? {}) as { full_name?: string; phone?: string };
    const { data: created } = await supabase
      .from("users")
      .upsert(
        { id: authUser.id, phone_number: meta.phone ?? "", display_name: meta.full_name ?? "", email: authUser.email ?? "" },
        { onConflict: "id" }
      )
      .select("*")
      .single();
    if (created) setProfile(created as Profile);
  };

  useEffect(() => {
    if (isDemoMode) return; // demo mode starts logged out; signIn/signUp handle the rest

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadOrCreateProfile(data.session.user);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) loadOrCreateProfile(newSession.user);
      else setProfile(null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Signup verification: a custom dual-channel OTP, NOT Supabase Auth's
  // built-in "Confirm signup" email/link. That built-in token can only ever
  // go out over whichever single channel Supabase's email settings are
  // wired to (Resend, via custom SMTP) — there's no way to also push the
  // identical token over SMS. So instead: signUp() below creates the
  // account as usual (still unconfirmed), then the caller (Register.tsx)
  // triggers sendSignupOtp() to generate and deliver OUR OWN 6-digit code
  // via whichever channel it asks for (email via Resend, sms via SMSala —
  // see supabase/functions/send-signup-otp). "Resend via the other
  // channel" is just calling sendSignupOtp() again with a different
  // channel. verifySignupOtp() checks that code and confirms the account
  // server-side; since confirming via the Admin API doesn't hand back a
  // session, it finishes by calling signInWithPassword itself using the
  // password the user already typed on the signup form. Regular login
  // (signIn, below) stays plain email+password, unaffected.
  const signUp: AuthContextValue["signUp"] = async ({ fullName, email, phone, password, referredBy }) => {
    if (isDemoMode) {
      setSession(DEMO_SESSION);
      setProfile({ ...DEMO_PROFILE, display_name: fullName || DEMO_PROFILE.display_name, email: email || DEMO_PROFILE.email, phone_number: phone || DEMO_PROFILE.phone_number });
      return {};
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone, referred_by: referredBy },
      },
    });
    if (error) return { error: error.message };
    // No session back means Supabase is holding this account pending
    // confirmation — that's the normal case; the user needs to enter the
    // OTP code (sent separately via sendSignupOtp) before they have a
    // session.
    return { needsVerification: !data.session, userId: data.user?.id };
  };

  const sendSignupOtp: AuthContextValue["sendSignupOtp"] = async ({ userId, email, phone, channel }) => {
    if (isDemoMode) return {};
    const { error } = await supabase.functions.invoke("send-signup-otp", {
      body: { user_id: userId, email, phone, channel },
    });
    if (error) return { error: await extractFunctionErrorMessage(error) };
    return {};
  };

  // Verifies the 6-digit code the user typed in on VerifyOtp.tsx, via our
  // own verify-signup-otp edge function (not supabase.auth.verifyOtp —
  // this code was never a Supabase Auth token to begin with). On success
  // the edge function has already confirmed the account server-side, so
  // finish by actually signing in with the password from the signup form —
  // this fires onAuthStateChange same as any normal login, which loads/
  // creates the profile row automatically.
  const verifySignupOtp: AuthContextValue["verifySignupOtp"] = async ({ userId, code, email, password }) => {
    if (isDemoMode) return {};
    const { error } = await supabase.functions.invoke("verify-signup-otp", {
      body: { user_id: userId, code },
    });
    if (error) return { error: await extractFunctionErrorMessage(error) };
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    return { error: signInError?.message };
  };

  const signIn: AuthContextValue["signIn"] = async ({ email, password }) => {
    if (isDemoMode) {
      setSession(DEMO_SESSION);
      setProfile({ ...DEMO_PROFILE, email: email || DEMO_PROFILE.email });
      return {};
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  };

  const signOut = async () => {
    if (isDemoMode) {
      setSession(null);
      setProfile(null);
      return;
    }
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (isDemoMode) return;
    if (session?.user) await loadOrCreateProfile(session.user);
  };

  const updateProfile: AuthContextValue["updateProfile"] = async (patch) => {
    if (isDemoMode) {
      setProfile((p) => (p ? { ...p, ...patch } : p));
      return {};
    }
    if (!session?.user) return { error: "Not authenticated" };
    const { error } = await supabase.from("users").update(patch).eq("id", session.user.id);
    if (!error) await loadOrCreateProfile(session.user);
    return { error: error?.message };
  };

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading,
      signUp,
      sendSignupOtp,
      verifySignupOtp,
      signIn,
      signOut,
      refreshProfile,
      updateProfile,
    }),
    [session, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
