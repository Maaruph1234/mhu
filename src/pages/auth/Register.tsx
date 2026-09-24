import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, User as UserIcon, Phone, Gift } from "lucide-react";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";

export default function Register() {
  const navigate = useNavigate();
  const { signUp, sendSignupOtp } = useAuth();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    referredBy: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      // No third-party identity check at signup (Sept 2026): this used to
      // gate registration on a Payvessel NIN lookup before an account could
      // even be created. Removed along with the rest of Payvessel -- the
      // real identity check now happens once, later, when someone verifies
      // their account to fund their wallet: Xpress Wallet's own POST /wallet
      // call validates their BVN against the BVN registry as part of
      // creating their dedicated Providus Bank account (see
      // xpresswallet-create-wallet and the "Verify your account" banner on
      // the dashboard). Signup itself is just account creation now.
      const fullName = `${form.firstName} ${form.lastName}`.trim();
      const verifiedPhone = form.phone;
      const { error: signUpError, needsVerification, userId } = await signUp({
        fullName,
        email: form.email,
        phone: verifiedPhone,
        password: form.password,
        referredBy: form.referredBy,
      });
      if (signUpError) throw new Error(signUpError);

      // If a session came back immediately (email confirmation disabled on
      // the project), skip straight to the dashboard instead of a verify
      // screen with nothing to verify.
      if (!needsVerification || !userId) {
        navigate("/dashboard");
        return;
      }

      // Kick off the first verification code now, over email by default —
      // VerifyOtp.tsx lets the user switch to SMS from there if they'd
      // rather (or didn't get the email).
      const { error: otpError } = await sendSignupOtp({
        userId,
        email: form.email,
        phone: verifiedPhone,
        channel: "email",
      });
      if (otpError) throw new Error(otpError);

      navigate("/verify-otp", {
        state: {
          email: form.email,
          phone: verifiedPhone,
          password: form.password,
          userId,
        },
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start moving money in minutes.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            placeholder="Aruf"
            icon={<UserIcon size={16} />}
            value={form.firstName}
            onChange={update("firstName")}
            required
          />
          <Input
            label="Last name"
            placeholder="Ibrahim"
            icon={<UserIcon size={16} />}
            value={form.lastName}
            onChange={update("lastName")}
            required
          />
        </div>
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          icon={<Mail size={16} />}
          value={form.email}
          onChange={update("email")}
          required
        />
        <Input
          label="Phone number"
          type="tel"
          placeholder="080XXXXXXXX"
          icon={<Phone size={16} />}
          value={form.phone}
          onChange={update("phone")}
          required
        />
        <Input
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          icon={<Lock size={16} />}
          value={form.password}
          onChange={update("password")}
          minLength={8}
          required
        />
        <Input
          label="Confirm password"
          type="password"
          placeholder="Re-enter your password"
          icon={<Lock size={16} />}
          value={form.confirmPassword}
          onChange={update("confirmPassword")}
          required
        />
        <Input
          label="Referral code (optional)"
          placeholder="e.g. 4F82A1C0"
          icon={<Gift size={16} />}
          value={form.referredBy}
          onChange={update("referredBy")}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" fullWidth loading={loading}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
