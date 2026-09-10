import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Mail, MessageSquare } from "lucide-react";
import clsx from "clsx";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useAuth } from "../../context/AuthContext";

type LocationState = {
  email?: string;
  phone?: string;
  password?: string;
  userId?: string;
  // Set when Payvessel's NIN check found a phone mismatch -- not a
  // blocking error (registration already went through), just a heads up.
  notice?: string;
} | null;

export default function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    email = "",
    phone = "",
    password = "",
    userId = "",
    notice,
  } = (location.state as LocationState) ?? {};
  const { sendSignupOtp, verifySignupOtp } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resendingChannel, setResendingChannel] = useState<"email" | "sms" | null>(null);
  const [resentChannel, setResentChannel] = useState<"email" | "sms" | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      const { error: verifyError } = await verifySignupOtp({ userId, code: code.trim(), email, password });
      if (verifyError) throw new Error(verifyError);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async (channel: "email" | "sms") => {
    setResendingChannel(channel);
    setError(null);
    setResentChannel(null);
    try {
      const { error: resendError } = await sendSignupOtp({ userId, email, phone, channel });
      if (resendError) throw new Error(resendError);
      setResentChannel(channel);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResendingChannel(null);
    }
  };

  return (
    <AuthLayout
      title="Verify your account"
      subtitle={email ? `We sent an 8-digit code to ${email}` : "We sent you a verification code"}
    >
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Mail size={28} />
        </div>
        <p className="text-sm text-slate-500">Enter the 8-digit code to activate your account.</p>
        {notice && (
          <p className="rounded-md bg-amber-400/10 px-3 py-2 text-sm text-amber-500">{notice}</p>
        )}
        <form onSubmit={handleVerify} className="space-y-4 text-left">
          <Input
            label="Verification code"
            inputMode="numeric"
            maxLength={8}
            placeholder="8-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {resentChannel && (
            <p className="text-sm text-emerald-400">
              Code resent via {resentChannel === "email" ? "email" : "SMS"}.
            </p>
          )}
          <Button type="submit" fullWidth loading={verifying} disabled={code.trim().length !== 8}>
            Verify
          </Button>
        </form>

        <div>
          <p className="mb-2 text-xs text-slate-500">Didn't get it? Resend via:</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Button
              type="button"
              variant="outline"
              icon={<Mail size={16} />}
              loading={resendingChannel === "email"}
              disabled={resendingChannel !== null}
              onClick={() => handleResend("email")}
              className={clsx(!email && "hidden")}
            >
              Email
            </Button>
            <Button
              type="button"
              variant="outline"
              icon={<MessageSquare size={16} />}
              loading={resendingChannel === "sms"}
              disabled={resendingChannel !== null}
              onClick={() => handleResend("sms")}
              className={clsx(!phone && "hidden")}
            >
              SMS
            </Button>
          </div>
        </div>

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
