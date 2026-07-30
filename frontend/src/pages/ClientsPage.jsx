import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

export default function ClientsPage() {
  const { apiFetch, user } = useAuth();
  const { invalidate } = useCatalog();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";
  const [clients, setClients] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [search, setSearch] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [patientOpen, setPatientOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientForm, setClientForm] = useState({ name: "", email: "", phone: "", clinic_id: "" });
  const [patientForm, setPatientForm] = useState({ name: "", species: "", breed: "" });
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const qs = search ? `?q=${encodeURIComponent(search)}` : "";
    const res = await apiFetch(`/api/clients${qs}`);
    if (res.ok) setClients(await res.json());
    if (isSystemAdmin) {
      const cl = await apiFetch("/api/clinics");
      if (cl.ok) setClinics(await cl.json());
    }
  }, [apiFetch, search, isSystemAdmin]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function createClient(e) {
    e.preventDefault();
    setError(null);
    if (isSystemAdmin && !clientForm.clinic_id) {
      setError("Select a clinic for this client.");
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
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? "Failed to create client.");
      return;
    }
    setClientOpen(false);
    setClientForm({ name: "", email: "", phone: "", clinic_id: "" });
    invalidate(["clients"]);
    load();
  }

  async function createPatient(e) {
    e.preventDefault();
    setError(null);
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
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? "Failed to create patient.");
      return;
    }
    setPatientOpen(false);
    setPatientForm({ name: "", species: "", breed: "" });
    invalidate(["clients"]);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Clients & Patients</h2>
          <p className="text-sm text-muted-foreground">Owner and pet records for bookings</p>
        </div>
        <Button onClick={() => { setClientOpen(true); setError(null); }}>
          <Plus className="mr-2 h-4 w-4" />Add Client
        </Button>
      </div>

      <Input
        placeholder="Search clients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="space-y-4">
        {clients.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">{c.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact info"}
                  {isSystemAdmin && c.clinic_id != null ? ` · Clinic #${c.clinic_id}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setSelectedClient(c); setPatientOpen(true); setError(null); }}
              >
                <Plus className="mr-1 h-3 w-3" />Patient
              </Button>
            </CardHeader>
            <CardContent>
              {(c.patients ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No patients yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {c.patients.filter((p) => p.is_active !== false).map((p) => (
                    <Badge key={p.id} variant="secondary">
                      {p.name}{p.species ? ` · ${p.species}` : ""}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {clients.length === 0 && (
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
            {error && <p className="text-sm text-destructive">{typeof error === "string" ? error : JSON.stringify(error)}</p>}
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
            {error && <p className="text-sm text-destructive">{typeof error === "string" ? error : JSON.stringify(error)}</p>}
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
