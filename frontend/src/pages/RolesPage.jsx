import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { readErrorMessage } from "@/lib/http";
import { can } from "@/lib/rbac";

export default function RolesPage() {
  const { apiFetch, user } = useAuth();
  const { invalidate } = useCatalog();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";
  const [roles, setRoles] = useState([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", can_prescribe: false, is_global: false });
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/roles?include_inactive=${includeInactive}`);
      if (!res.ok) {
        setLoadError(await readErrorMessage(res, "Failed to load roles."));
        return;
      }
      setLoadError(null);
      setRoles(await res.json());
    } catch {
      setLoadError("Failed to load roles.");
    }
  }, [apiFetch, includeInactive]);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    setError(null);
    const body = {
      name: form.name.trim(),
      can_prescribe: form.can_prescribe,
    };
    if (isSystemAdmin && form.is_global) body.is_global = true;
    const res = await apiFetch("/api/roles", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(await readErrorMessage(res, "Failed to create role."));
      return;
    }
    setOpen(false);
    setForm({ name: "", can_prescribe: false, is_global: false });
    invalidate(["roles"]);
    load();
  }

  async function toggleActive(role) {
    if (role.is_active && !window.confirm(`Deactivate role "${role.name}"?`)) return;
    setLoadError(null);
    const res = await apiFetch(`/api/roles/${role.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !role.is_active }),
    });
    if (!res.ok) {
      setLoadError(await readErrorMessage(res, "Failed to update role."));
      return;
    }
    invalidate(["roles"]);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Clinical roles</h2>
          <p className="text-sm text-muted-foreground">
            Job roles for staff (Vet, Tech…). Distinct from system access roles.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="roles-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
            <Label htmlFor="roles-inactive" className="text-sm text-muted-foreground">Show inactive</Label>
          </div>
          {can(user?.system_role, "manageClinicalRoles") && (
            <Button onClick={() => { setOpen(true); setError(null); }}>
              <Plus className="mr-2 h-4 w-4" />Add Role
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Roles</CardTitle></CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Scope</th>
                    <th className="pb-2 pr-4">Prescribe</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id} className={`border-b last:border-0 ${!r.is_active ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-4 font-medium">{r.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {r.clinic_id == null ? "Global" : `Clinic #${r.clinic_id}`}
                      </td>
                      <td className="py-2 pr-4">{r.can_prescribe ? "Yes" : "No"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.is_active ? "success" : "outline"}>
                          {r.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-2">
                        {(r.clinic_id != null || isSystemAdmin) ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toggleActive(r)}>
                            {r.is_active ? "Deactivate" : "Reactivate"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">System only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Clinical Role</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="can-prescribe"
                checked={form.can_prescribe}
                onCheckedChange={(v) => setForm((f) => ({ ...f, can_prescribe: v }))}
              />
              <Label htmlFor="can-prescribe">Can prescribe</Label>
            </div>
            {isSystemAdmin && (
              <div className="flex items-center gap-2">
                <Switch
                  id="is-global"
                  checked={form.is_global}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_global: v }))}
                />
                <Label htmlFor="is-global">Global catalog role</Label>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
