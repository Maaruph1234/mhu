import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock } from "lucide-react";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signInError } = await signIn(form);
      if (signInError) throw new Error(signInError);
      navigate("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to your MHU Global wallet.">
      <form onSubmit={handleSubmit} className="space-y-4">
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
          label="Password"
          type="password"
          placeholder="Your password"
          icon={<Lock size={16} />}
          value={form.password}
          onChange={update("password")}
          required
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs text-slate-500 hover:text-accent">
            Forgot password?
          </Link>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" fullWidth loading={loading}>
          Log in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link to="/register" className="font-medium text-accent hover:underline">
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}
