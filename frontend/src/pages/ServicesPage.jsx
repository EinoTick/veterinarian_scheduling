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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

export default function ServicesPage() {
  const { apiFetch, user } = useAuth();
  const { clinics, ensure, invalidate } = useCatalog();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";
  const [items, setItems] = useState([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", default_duration_minutes: "30", clinic_id: "" });
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/services?include_inactive=${includeInactive}`);
    if (res.ok) setItems(await res.json());
    if (isSystemAdmin) await ensure(["clinics"]);
  }, [apiFetch, ensure, includeInactive, isSystemAdmin]);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    setError(null);
    const body = {
      name: form.name,
      default_duration_minutes: Number(form.default_duration_minutes) || 30,
    };
    if (isSystemAdmin && form.clinic_id) body.clinic_id = Number(form.clinic_id);
    const res = await apiFetch("/api/services", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? "Failed to create service.");
      return;
    }
    setOpen(false);
    setForm({ name: "", default_duration_minutes: "30", clinic_id: "" });
    invalidate(["services"]);
    load();
  }

  async function toggleActive(s) {
    await apiFetch(`/api/services/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !s.is_active }),
    });
    invalidate(["services"]);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Services</h2>
          <p className="text-sm text-muted-foreground">Appointment service types</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} id="svc-inactive" />
            <Label htmlFor="svc-inactive" className="text-sm text-muted-foreground">Show inactive</Label>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add Service</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Service catalog</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Duration</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className={`border-b last:border-0 ${!s.is_active ? "opacity-50" : ""}`}>
                  <td className="py-2 pr-4 font-medium">{s.name}</td>
                  <td className="py-2 pr-4">{s.default_duration_minutes} min</td>
                  <td className="py-2 pr-4">
                    <Badge variant={s.is_active ? "secondary" : "outline"}>
                      {s.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleActive(s)}>
                      {s.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Service</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-3">
            {isSystemAdmin && (
              <div className="space-y-1">
                <Label>Clinic</Label>
                <Select value={form.clinic_id} onValueChange={(v) => setForm((f) => ({ ...f, clinic_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select clinic…" /></SelectTrigger>
                  <SelectContent>
                    {clinics.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <Label>Default duration (minutes)</Label>
              <Input
                type="number"
                min="1"
                value={form.default_duration_minutes}
                onChange={(e) => setForm((f) => ({ ...f, default_duration_minutes: e.target.value }))}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{typeof error === "string" ? error : JSON.stringify(error)}</p>}
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
