import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function CreateUserModal({ open, onClose, onCreated }) {
  const { apiFetch, user: currentUser } = useAuth();
  const isSysAdmin = currentUser?.system_role === "SYSTEM_ADMIN";

  const [clinicalRoles, setClinicalRoles] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [form, setForm] = useState({
    name: "", email: "", password: "", system_role: "USER", role_id: "", clinic_id: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    const safe = (r) => (r.ok ? r.json() : []);
    Promise.all([
      apiFetch("/api/roles").then(safe),
      isSysAdmin ? apiFetch("/api/clinics").then(safe) : Promise.resolve([]),
    ]).then(([roles, clinicList]) => {
      setClinicalRoles(roles);
      setClinics(clinicList);
    }).catch(() => {});
  }, [open, apiFetch, isSysAdmin]);

  function resetForm() {
    setForm({ name: "", email: "", password: "", system_role: "USER", role_id: "", clinic_id: "" });
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  const needsClinic = isSysAdmin && form.system_role !== "SYSTEM_ADMIN";

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (needsClinic && !form.clinic_id) {
      setError("Please select a clinic for this user.");
      return;
    }

    setSubmitting(true);

    const body = {
      name: form.name,
      email: form.email,
      password: form.password,
      system_role: form.system_role,
      role_id: form.role_id ? Number(form.role_id) : null,
      clinic_id: form.clinic_id ? Number(form.clinic_id) : null,
    };

    let res;
    try {
      res = await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch {
      setSubmitting(false);
      setError("Network error — is the backend running?");
      return;
    }

    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json();
      setError(err.detail ?? "Failed to create user.");
      return;
    }

    resetForm();
    onCreated?.();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Staff Member</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Dr. Jane Smith"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@clinic.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Temporary Password</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="They should change this on first login"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Clinical Role</Label>
              <Select
                value={form.role_id}
                onValueChange={(v) => setForm((f) => ({ ...f, role_id: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select role…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {clinicalRoles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>System Access</Label>
              <Select
                value={form.system_role}
                onValueChange={(v) => setForm((f) => ({ ...f, system_role: v, clinic_id: "" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">User</SelectItem>
                  <SelectItem value="CLINIC_ADMIN">Clinic Admin</SelectItem>
                  {isSysAdmin && (
                    <SelectItem value="SYSTEM_ADMIN">System Admin</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isSysAdmin && form.system_role !== "SYSTEM_ADMIN" && (
            <div className="space-y-1">
              <Label>
                Clinic <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.clinic_id}
                onValueChange={(v) => setForm((f) => ({ ...f, clinic_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select clinic…" />
                </SelectTrigger>
                <SelectContent>
                  {clinics.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
