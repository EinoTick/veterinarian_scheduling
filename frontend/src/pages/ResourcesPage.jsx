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
import { unwrapList, readErrorMessage, listCountLabel } from "@/lib/http";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { LIST_FETCH_LIMIT } from "@/lib/constants";

export default function ResourcesPage() {
  const { apiFetch, user } = useAuth();
  const { clinics, ensure, invalidate } = useCatalog();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";
  const [items, setItems] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", resource_type: "room", category: "", clinic_id: "" });
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/resources?include_inactive=${includeInactive}&limit=${LIST_FETCH_LIMIT}`
      );
      if (!res.ok) {
        setLoadError(await readErrorMessage(res, "Failed to load resources."));
        return;
      }
      setLoadError(null);
      const body = await res.json();
      const { items: list, total } = unwrapList(body);
      setItems(list);
      setListTotal(total);
      if (isSystemAdmin) {
        try {
          await ensure(["clinics"]);
        } catch {
          /* catalog banner surfaces this */
        }
      }
    } catch {
      setLoadError("Failed to load resources.");
    }
  }, [apiFetch, ensure, includeInactive, isSystemAdmin]);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    setError(null);
    if (isSystemAdmin && !form.clinic_id) {
      setError("Select a clinic for this resource.");
      return;
    }
    const body = {
      name: form.name,
      resource_type: form.resource_type,
      category: form.category || null,
    };
    if (isSystemAdmin && form.clinic_id) body.clinic_id = Number(form.clinic_id);
    const res = await apiFetch("/api/resources", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      setError(await readErrorMessage(res, "Failed to create resource."));
      return;
    }
    setOpen(false);
    setForm({ name: "", resource_type: "room", category: "", clinic_id: "" });
    invalidate(["resources"]);
    load();
  }

  async function toggleActive(r) {
    if (r.is_active) {
      if (!(await confirm({
        title: "Deactivate resource?",
        description: `Deactivate "${r.name}"?`,
        destructive: true,
        confirmLabel: "Deactivate",
      }))) return;
    }
    setLoadError(null);
    const res = await apiFetch(`/api/resources/${r.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !r.is_active }),
    });
    if (!res.ok) {
      setLoadError(await readErrorMessage(res, "Failed to update resource."));
      return;
    }
    invalidate(["resources"]);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Resources</h2>
          <p className="text-sm text-muted-foreground">Rooms and equipment</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} id="res-inactive" />
            <Label htmlFor="res-inactive" className="text-sm text-muted-foreground">Show inactive</Label>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add Resource</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          {!loadError && items.length > 0 && (
            <p className="text-sm font-normal text-muted-foreground">
              {listCountLabel(items.length, listTotal)}
              {listTotal > items.length ? " — list truncated at fetch limit." : ""}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resources found.</p>
          ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className={`border-b last:border-0 ${!r.is_active ? "opacity-50" : ""}`}>
                  <td className="py-2 pr-4 font-medium">{r.name}</td>
                  <td className="py-2 pr-4">{r.resource_type}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{r.category ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={r.is_active ? "secondary" : "outline"}>
                      {r.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleActive(r)}>
                      {r.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Resource</DialogTitle></DialogHeader>
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
              <Label>Type</Label>
              <Select value={form.resource_type} onValueChange={(v) => setForm((f) => ({ ...f, resource_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="room">Room</SelectItem>
                  <SelectItem value="equipment">Equipment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Category (optional)</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="exam_room, dental_suite…"
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

      <ConfirmDialog />
    </div>
  );
}
