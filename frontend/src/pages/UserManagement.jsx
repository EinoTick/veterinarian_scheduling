import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ROLE_BADGE = {
  SYSTEM_ADMIN: "destructive",
  CLINIC_ADMIN: "default",
  USER: "secondary",
};

export default function UserManagement() {
  const { apiFetch, user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [clinicalRoles, setClinicalRoles] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({
    name: "", email: "", password: "", system_role: "USER", role_id: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(false);

  async function loadUsers() {
    const [usersRes, rolesRes] = await Promise.all([
      apiFetch("/api/users"),
      apiFetch("/api/roles"),
    ]);
    if (!usersRes.ok) { setLoadError("Failed to load users."); return; }
    setUsers(await usersRes.json());
    setClinicalRoles(await rolesRes.json());
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleCreateUser(e) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(false);
    setSubmitting(true);

    const body = {
      name: form.name,
      email: form.email,
      password: form.password,
      system_role: form.system_role,
      role_id: form.role_id ? Number(form.role_id) : null,
    };

    const res = await apiFetch("/api/users", {
      method: "POST",
      body: JSON.stringify(body),
    });

    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json();
      setFormError(err.detail ?? "Failed to create user.");
      return;
    }

    setFormSuccess(true);
    setForm({ name: "", email: "", password: "", system_role: "USER", role_id: "" });
    loadUsers();
  }

  return (
    <div className="space-y-6">
      {/* User table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Staff
            {currentUser?.system_role === "SYSTEM_ADMIN" && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">(all clinics)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Email</th>
                    <th className="pb-2 pr-4">Clinical Role</th>
                    <th className="pb-2">System Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{u.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.email}</td>
                      <td className="py-2 pr-4">{u.role?.name ?? "—"}</td>
                      <td className="py-2">
                        <Badge variant={ROLE_BADGE[u.system_role] ?? "secondary"}>
                          {u.system_role}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add user form */}
      <Card>
        <CardHeader><CardTitle>Add Staff Member</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreateUser} className="space-y-4">
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
                  onValueChange={(v) => setForm((f) => ({ ...f, system_role: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">User</SelectItem>
                    <SelectItem value="CLINIC_ADMIN">Clinic Admin</SelectItem>
                    {currentUser?.system_role === "SYSTEM_ADMIN" && (
                      <SelectItem value="SYSTEM_ADMIN">System Admin</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
            {formSuccess && <p className="text-sm text-green-600">User created successfully.</p>}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Creating…" : "Create User"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
