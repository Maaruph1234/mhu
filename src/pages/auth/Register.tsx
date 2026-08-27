import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, User as UserIcon, Phone, Gift, ShieldCheck } from "lucide-react";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";
import * as korapay from "../../lib/korapay";

export default function Register() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    bvn: "",
    password: "",
    referredBy: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Identity check happens BEFORE any account is created: the name and
      // phone number entered here must match what Korapay's BVN Lookup
      // returns for that BVN, or registration is declined outright. See
      // supabase/functions/korapay-verify-bvn for the actual matching logic.
      const { verified, reason, firstName, lastName, phone } = await korapay.verifyBvn({
        bvn: form.bvn,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
      });
      if (!verified) {
        throw new Error(reason || "We couldn't verify those details against your BVN. Please check and try again.");
      }

      // Use the BVN record's own name/phone (returned above) to populate the
      // account rather than whatever was typed -- guarantees the profile
      // matches the government record exactly, correct spelling included.
      const fullName = `${firstName || form.firstName} ${lastName || form.lastName}`.trim();
      const verifiedPhone = phone || form.phone;
      const { error: signUpError, needsVerification } = await signUp({
        fullName,
        email: form.email,
        phone: verifiedPhone,
        password: form.password,
        referredBy: form.referredBy,
      });
      if (signUpError) throw new Error(signUpError);

      // Supabase sends the "Confirm signup" email itself as part of signUp()
      // above — nothing to trigger manually here. If a session came back
      // immediately (email confirmation disabled on the project), skip
      // straight to the dashboard instead of a verify screen with nothing
      // to verify.
      if (!needsVerification) {
        navigate("/dashboard");
        return;
      }

      navigate("/verify-otp", { state: { email: form.email, fullName, phone: verifiedPhone } });
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
          label="BVN"
          placeholder="11-digit BVN"
          icon={<ShieldCheck size={16} />}
          value={form.bvn}
          onChange={update("bvn")}
          maxLength={11}
          required
        />
        <p className="-mt-2 text-xs text-slate-400">
          Your name and phone number must match your BVN record — this is how we confirm it's really you.
        </p>
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
