import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { validatePassword, PASSWORD_HINT } from "@/lib/password";
import { readErrorMessage } from "@/lib/http";

export default function ChangePasswordPage() {
  const { apiFetch } = useAuth();
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (form.new_password !== form.confirm_password) {
      setError("New passwords do not match.");
      return;
    }

    const pwError = validatePassword(form.new_password);
    if (pwError) {
      setError(pwError);
      return;
    }

    setSubmitting(true);

    let res;
    try {
      res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
        }),
      });
    } catch {
      setSubmitting(false);
      setError("Network error — is the backend running?");
      return;
    }

    setSubmitting(false);

    if (!res.ok) {
      setError(await readErrorMessage(res, "Failed to change password."));
      return;
    }

    setSuccess(true);
    setForm({ current_password: "", new_password: "", confirm_password: "" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Change Password</h2>
        <p className="text-sm text-muted-foreground">Update your account password</p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>New Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>Current Password</Label>
              <Input
                type="password"
                value={form.current_password}
                onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>New Password</Label>
              <Input
                type="password"
                value={form.new_password}
                onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
                required
                minLength={10}
              />
              <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
            </div>
            <div className="space-y-1">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                value={form.confirm_password}
                onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-600">Password updated successfully.</p>}

            <Button type="submit" disabled={submitting}>
              {submitting ? "Updating…" : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
