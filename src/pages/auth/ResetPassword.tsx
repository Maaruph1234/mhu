import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { supabase } from "../../lib/supabaseClient";

/**
 * Landing page for the link in Supabase's password-reset email. Both apps
 * point their "forgot password" flow at this one page (see
 * ForgotPassword.tsx's redirectTo and the Flutter login screen's
 * _forgotPassword) since an email link always opens in a browser
 * regardless of which app requested it -- there's no separate mobile-app
 * version of this screen needed.
 *
 * Clicking the email link makes the Supabase client auto-parse a recovery
 * token out of the URL and establish a temporary session, firing a
 * PASSWORD_RECOVERY auth event. That's what actually authorizes the
 * updateUser() call below -- without it this page has nothing to act on.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    // Covers the case where the recovery event already fired (e.g. the
    // client parsed the URL) before this listener was attached.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    // No valid recovery session showed up within a few seconds -- the link
    // is expired, already used, or someone landed here directly.
    const timeout = setTimeout(() => {
      setReady((r) => {
        if (!r) setInvalidLink(true);
        return r;
      });
    }, 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      setDone(true);
      await supabase.auth.signOut();
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (invalidLink) {
    return (
      <AuthLayout title="Link expired" subtitle="This password reset link is invalid or has already been used.">
        <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
          Request a new reset link
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password updated" subtitle="You can now log in with your new password.">
        <p className="text-sm text-emerald-400">Redirecting you to login…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a new password for your MHU Global account.">
      {!ready ? (
        <p className="text-sm text-slate-500">Verifying your reset link…</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New password"
            type="password"
            placeholder="At least 8 characters"
            icon={<Lock size={16} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            placeholder="Re-enter your password"
            icon={<Lock size={16} />}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" fullWidth loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
