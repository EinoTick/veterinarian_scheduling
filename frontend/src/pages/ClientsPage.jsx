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
import { readErrorMessage } from "@/lib/http";

export default function ClientsPage() {
  const { apiFetch, user } = useAuth();
  const { invalidate } = useCatalog();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";
  const [clients, setClients] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [patientOpen, setPatientOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientForm, setClientForm] = useState({ name: "", email: "", phone: "", clinic_id: "" });
  const [patientForm, setPatientForm] = useState({ name: "", species: "", breed: "" });
  const [loadError, setLoadError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (includeInactive) params.set("include_inactive", "true");
    const qs = params.toString() ? `?${params}` : "";
    try {
      const res = await apiFetch(`/api/clients${qs}`);
      if (!res.ok) {
        setLoadError(await readErrorMessage(res, "Failed to load clients."));
        return;
      }
      setLoadError(null);
      setClients(await res.json());
      if (isSystemAdmin) {
        const cl = await apiFetch("/api/clinics");
        if (!cl.ok) {
          setLoadError(await readErrorMessage(cl, "Failed to load clinics."));
          return;
        }
        setClinics(await cl.json());
      }
    } catch {
      setLoadError("Failed to load clients.");
    }
  }, [apiFetch, search, includeInactive, isSystemAdmin]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function createClient(e) {
    e.preventDefault();
    setFormError(null);
    if (isSystemAdmin && !clientForm.clinic_id) {
      setFormError("Select a clinic for this client.");
      return;
    }
    const body = {
      name: clientForm.name,
      email: clientForm.email || null,
      phone: clientForm.phone || null,
    };
    if (isSystemAdmin && clientForm.clinic_id) {
      body.clinic_id = Number(clientForm.clinic_id);
    }
    const res = await apiFetch("/api/clients", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setFormError(await readErrorMessage(res, "Failed to create client."));
      return;
    }
    setClientOpen(false);
    setClientForm({ name: "", email: "", phone: "", clinic_id: "" });
    invalidate(["clients"]);
    load();
  }

  async function createPatient(e) {
    e.preventDefault();
    setFormError(null);
    const res = await apiFetch("/api/patients", {
      method: "POST",
      body: JSON.stringify({
        client_id: selectedClient.id,
        name: patientForm.name,
        species: patientForm.species || null,
        breed: patientForm.breed || null,
      }),
    });
    if (!res.ok) {
      setFormError(await readErrorMessage(res, "Failed to create patient."));
      return;
    }
    setPatientOpen(false);
    setPatientForm({ name: "", species: "", breed: "" });
    invalidate(["clients"]);
    load();
  }

  async function toggleClientActive(client) {
    if (client.is_active && !window.confirm(`Deactivate client "${client.name}"? They cannot be selected for new bookings.`)) {
      return;
    }
    setBusyKey(`c-${client.id}`);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !client.is_active }),
      });
      if (!res.ok) {
        setLoadError(await readErrorMessage(res, "Failed to update client."));
        return;
      }
      invalidate(["clients"]);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function togglePatientActive(patient, clientName) {
    if (patient.is_active && !window.confirm(`Deactivate patient "${patient.name}" (${clientName})?`)) {
      return;
    }
    setBusyKey(`p-${patient.id}`);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/patients/${patient.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !patient.is_active }),
      });
      if (!res.ok) {
        setLoadError(await readErrorMessage(res, "Failed to update patient."));
        return;
      }
      invalidate(["clients"]);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Clients & Patients</h2>
          <p className="text-sm text-muted-foreground">Owner and pet records for bookings</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch
              id="clients-inactive"
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
            />
            <Label htmlFor="clients-inactive" className="text-sm text-muted-foreground">
              Show inactive
            </Label>
          </div>
          <Button onClick={() => { setClientOpen(true); setFormError(null); }}>
            <Plus className="mr-2 h-4 w-4" />Add Client
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search clients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <div className="space-y-4">
        {clients.map((c) => {
          const patients = (c.patients ?? []).filter(
            (p) => includeInactive || p.is_active !== false
          );
          return (
            <Card key={c.id} className={!c.is_active ? "opacity-60" : undefined}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3 pb-2">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    {c.name}
                    {!c.is_active && <Badge variant="outline">Inactive</Badge>}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact info"}
                    {isSystemAdmin && c.clinic_id != null ? ` · Clinic #${c.clinic_id}` : ""}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyKey === `c-${c.id}`}
                    onClick={() => toggleClientActive(c)}
                  >
                    {c.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                  {c.is_active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setSelectedClient(c); setPatientOpen(true); setFormError(null); }}
                    >
                      <Plus className="mr-1 h-3 w-3" />Patient
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {patients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No patients yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {patients.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-medium">{p.name}</span>
                          {p.species ? (
                            <span className="text-xs text-muted-foreground"> · {p.species}</span>
                          ) : null}
                          {!p.is_active && (
                            <Badge variant="outline" className="ml-2">Inactive</Badge>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs shrink-0"
                          disabled={busyKey === `p-${p.id}`}
                          onClick={() => togglePatientActive(p, c.name)}
                        >
                          {p.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
        {!loadError && clients.length === 0 && (
          <p className="text-sm text-muted-foreground">No clients found.</p>
        )}
      </div>

      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Client</DialogTitle></DialogHeader>
          <form onSubmit={createClient} className="space-y-3">
            {isSystemAdmin && (
              <div className="space-y-1">
                <Label>Clinic</Label>
                <Select
                  value={clientForm.clinic_id}
                  onValueChange={(v) => setClientForm((f) => ({ ...f, clinic_id: v }))}
                  required
                >
                  <SelectTrigger><SelectValue placeholder="Select clinic" /></SelectTrigger>
                  <SelectContent>
                    {clinics.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={clientForm.name} onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={clientForm.email} onChange={(e) => setClientForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={clientForm.phone} onChange={(e) => setClientForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClientOpen(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={patientOpen} onOpenChange={setPatientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Patient{selectedClient ? ` for ${selectedClient.name}` : ""}</DialogTitle>
          </DialogHeader>
          <form onSubmit={createPatient} className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={patientForm.name} onChange={(e) => setPatientForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Species</Label>
                <Input value={patientForm.species} onChange={(e) => setPatientForm((f) => ({ ...f, species: e.target.value }))} placeholder="Dog, Cat…" />
              </div>
              <div className="space-y-1">
                <Label>Breed</Label>
                <Input value={patientForm.breed} onChange={(e) => setPatientForm((f) => ({ ...f, breed: e.target.value }))} />
              </div>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPatientOpen(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
