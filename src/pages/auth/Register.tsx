import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, User as UserIcon, Phone, Gift, ShieldCheck } from "lucide-react";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";
import * as payvessel from "../../lib/payvessel";

export default function Register() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    gender: "" as "" | "MALE" | "FEMALE",
    birthday: "",
    email: "",
    phone: "",
    bvn: "",
    password: "",
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
    setLoading(true);
    try {
      // Identity check happens BEFORE any account is created: the name,
      // gender, date of birth, and phone number entered here must match
      // what Payvessel's Basic BVN Verification says for that BVN, or
      // registration is declined outright. See
      // supabase/functions/payvessel-verify-bvn for the actual matching
      // logic (switched from Enhanced to Basic -- see that file's header
      // comment for why).
      if (!form.gender) throw new Error("Select a gender");
      const { verified, reason } = await payvessel.verifyBvn({
        bvn: form.bvn,
        firstName: form.firstName,
        middleName: form.middleName,
        lastName: form.lastName,
        gender: form.gender,
        birthday: form.birthday,
        phone: form.phone,
      });
      if (!verified) {
        throw new Error(reason || "We couldn't verify those details against your BVN. Please check and try again.");
      }

      // Basic BVN Verification only returns match verdicts, not the
      // record's own name/phone (unlike Enhanced) -- since it's already
      // confirmed to match, use exactly what was typed.
      const fullName = `${form.firstName} ${form.lastName}`.trim();
      const verifiedPhone = form.phone;
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
          label="Middle name (optional)"
          placeholder="Leave blank if none"
          icon={<UserIcon size={16} />}
          value={form.middleName}
          onChange={update("middleName")}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Gender</label>
            <select
              value={form.gender}
              onChange={update("gender")}
              required
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Select</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
          </div>
          <Input
            label="Date of birth"
            type="date"
            value={form.birthday}
            onChange={update("birthday")}
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
          Your name, gender, date of birth, and phone number must match your BVN record — this is how we
          confirm it's really you.
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
