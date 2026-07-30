import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { unwrapList, readErrorMessage, listCountLabel } from "@/lib/http";
import { can, COMMON_TIMEZONES } from "@/lib/rbac";
import { LIST_FETCH_LIMIT } from "@/lib/constants";

export default function ClinicsPage() {
  const { apiFetch, user } = useAuth();
  const { invalidate } = useCatalog();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";
  const [clinics, setClinics] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", timezone: "UTC" });
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/clinics?limit=${LIST_FETCH_LIMIT}`);
      if (!res.ok) {
        setLoadError(await readErrorMessage(res, "Failed to load clinics."));
        return;
      }
      const body = await res.json();
      const { items, total } = unwrapList(body);
      setLoadError(null);
      setClinics(items);
      setListTotal(total);
      setDrafts(
        Object.fromEntries(
          items.map((c) => [c.id, { name: c.name, timezone: c.timezone || "UTC" }])
        )
      );
    } catch {
      setLoadError("Failed to load clinics.");
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  async function saveClinic(clinicId) {
    const draft = drafts[clinicId];
    if (!draft?.name?.trim()) {
      setSaveError("Clinic name is required.");
      return;
    }
    setBusyId(clinicId);
    setSaveError(null);
    try {
      const res = await apiFetch(`/api/clinics/${clinicId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name.trim(),
          timezone: draft.timezone || "UTC",
        }),
      });
      if (!res.ok) {
        setSaveError(await readErrorMessage(res, "Failed to update clinic."));
        return;
      }
      invalidate(["clinics"]);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function createClinic(e) {
    e.preventDefault();
    setSaveError(null);
    if (!createForm.name.trim()) {
      setSaveError("Clinic name is required.");
      return;
    }
    const res = await apiFetch("/api/clinics", {
      method: "POST",
      body: JSON.stringify({
        name: createForm.name.trim(),
        timezone: createForm.timezone || "UTC",
      }),
    });
    if (!res.ok) {
      setSaveError(await readErrorMessage(res, "Failed to create clinic."));
      return;
    }
    setCreateOpen(false);
    setCreateForm({ name: "", timezone: "UTC" });
    invalidate(["clinics"]);
    await load();
  }

  function updateDraft(id, field, value) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));
  }

  const timezoneOptions = (current) => {
    const set = new Set(COMMON_TIMEZONES);
    if (current && !set.has(current)) set.add(current);
    return [...set];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Clinic settings</h2>
          <p className="text-sm text-muted-foreground">
            Name and IANA timezone used for booking and calendars
          </p>
        </div>
        {can(user?.system_role, "createClinic") && (
          <Button onClick={() => { setCreateOpen(true); setSaveError(null); }}>
            <Plus className="mr-2 h-4 w-4" />Add Clinic
          </Button>
        )}
      </div>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}
      {!loadError && clinics.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {listCountLabel(clinics.length, listTotal)}
          {listTotal > clinics.length ? " — list truncated at fetch limit." : ""}
        </p>
      )}

      <div className="space-y-4">
        {clinics.map((c) => {
          const draft = drafts[c.id] ?? { name: c.name, timezone: c.timezone };
          const dirty =
            draft.name !== c.name || (draft.timezone || "UTC") !== (c.timezone || "UTC");
          return (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {c.name}
                  {isSystemAdmin && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      #{c.id}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`clinic-name-${c.id}`}>Name</Label>
                    <Input
                      id={`clinic-name-${c.id}`}
                      value={draft.name}
                      onChange={(e) => updateDraft(c.id, "name", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`clinic-tz-${c.id}`}>Timezone</Label>
                    <Select
                      value={draft.timezone || "UTC"}
                      onValueChange={(v) => updateDraft(c.id, "timezone", v)}
                    >
                      <SelectTrigger id={`clinic-tz-${c.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timezoneOptions(draft.timezone).map((tz) => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!dirty || busyId === c.id}
                    onClick={() => saveClinic(c.id)}
                  >
                    {busyId === c.id ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!loadError && clinics.length === 0 && (
          <p className="text-sm text-muted-foreground">No clinics found.</p>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Clinic</DialogTitle></DialogHeader>
          <form onSubmit={createClinic} className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Timezone</Label>
              <Select
                value={createForm.timezone}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, timezone: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
