import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";

export default function VerifyOtp() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email ?? "";
  const { resendVerification } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleResend = async () => {
    setResending(true);
    setError(null);
    setResent(false);
    try {
      const { error: resendError } = await resendVerification(email);
      if (resendError) throw new Error(resendError);
      setResent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Check your email"
      subtitle={email ? `We sent a confirmation link to ${email}` : "We sent you a confirmation link"}
    >
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Mail size={28} />
        </div>
        <p className="text-sm text-slate-500">
          Open the email and click the confirmation link to activate your account. You can close this tab — once
          you confirm, come back and log in.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {resent && <p className="text-sm text-emerald-400">Email resent.</p>}
        <Button type="button" variant="ghost" fullWidth loading={resending} onClick={handleResend}>
          Resend email
        </Button>
        <p className="text-center text-sm text-slate-500">
          Already confirmed?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
