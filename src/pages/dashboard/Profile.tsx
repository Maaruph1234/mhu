import { useState } from "react";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";
import { initials } from "../../lib/format";
import { IdentityVerificationCard } from "../../components/dashboard/IdentityVerificationCard";

export default function Profile() {
  const { profile, user, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await updateProfile({ display_name: displayName });
    if (updateError) setError(updateError);
    else {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your account details.</p>
      </div>

      <Card className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-xl font-bold text-accent">
          {profile ? initials(profile.display_name || profile.email || "") : "—"}
        </div>
        <div>
          <p className="font-semibold text-slate-900">{profile?.display_name}</p>
          <p className="text-sm text-slate-500">{profile?.email}</p>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <Input label="Full name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Input label="Email" value={profile?.email ?? ""} disabled />
          <Input label="Phone number" value={profile?.phone_number ?? ""} disabled />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {saved && <p className="text-sm text-emerald-400">Saved.</p>}
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </form>
      </Card>

      <IdentityVerificationCard />

      <Button variant="outline" fullWidth icon={<LogOut size={16} />} onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}
