import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function BookingModal({ open, onClose, onBooked }) {
  const { apiFetch } = useAuth();
  const [services, setServices] = useState([]);
  const [users, setUsers] = useState([]);
  const [resources, setResources] = useState([]);

  const [form, setForm] = useState({
    service_id: "",
    start_time: "",
    client_name: "",
    patient_name: "",
    staff_ids: [],
    resource_ids: [],
  });

  const [softViolations, setSoftViolations] = useState(null);
  const [overridingUserId, setOverridingUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    const safe = (r) => r.ok ? r.json() : [];
    Promise.all([
      apiFetch("/api/services").then(safe),
      apiFetch("/api/users").then(safe),
      apiFetch("/api/resources").then(safe),
    ]).then(([s, u, res]) => {
      setServices(s);
      setUsers(u);
      setResources(res);
    });
  }, [open]);

  function resetState() {
    setForm({ service_id: "", start_time: "", client_name: "", patient_name: "", staff_ids: [], resource_ids: [] });
    setSoftViolations(null);
    setOverridingUserId("");
    setError(null);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function toggleMulti(field, id) {
    setForm((f) => {
      const current = f[field];
      return {
        ...f,
        [field]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      };
    });
  }

  function buildPayload(override = false) {
    return {
      service_id: Number(form.service_id),
      start_time: form.start_time,
      client_name: form.client_name,
      patient_name: form.patient_name,
      allocations: [
        ...form.staff_ids.map((id) => ({ user_id: id })),
        ...form.resource_ids.map((id) => ({ resource_id: id })),
      ],
      override,
      overriding_user_id: override && overridingUserId ? Number(overridingUserId) : null,
    };
  }

  async function submitBooking(override = false) {
    setSubmitting(true);
    setError(null);

    const res = await apiFetch("/api/appointments", {
      method: "POST",
      body: JSON.stringify(buildPayload(override)),
    });

    setSubmitting(false);

    if (res.ok) {
      const appt = await res.json();
      resetState();
      onBooked?.(appt);
      onClose();
      return;
    }

    const body = await res.json();
    const detail = body.detail;

    if (res.status === 422 && detail?.type === "soft_stop") {
      setSoftViolations(detail.violations);
      return;
    }

    if (res.status === 400 && detail?.type === "hard_stop") {
      setError({ type: "hard_stop", violations: detail.violations });
      return;
    }

    setError({ type: "generic", message: JSON.stringify(detail) });
  }

  const hasSoftStop = softViolations && softViolations.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Appointment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Service</Label>
            <Select
              value={form.service_id}
              onValueChange={(v) => setForm((f) => ({ ...f, service_id: v }))}
              disabled={hasSoftStop}
            >
              <SelectTrigger><SelectValue placeholder="Select service…" /></SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} ({s.default_duration_minutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Start Time</Label>
            <Input
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
              disabled={hasSoftStop}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Client Name</Label>
              <Input
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                disabled={hasSoftStop}
              />
            </div>
            <div className="space-y-1">
              <Label>Patient Name</Label>
              <Input
                value={form.patient_name}
                onChange={(e) => setForm((f) => ({ ...f, patient_name: e.target.value }))}
                disabled={hasSoftStop}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Assign Staff</Label>
            <div className="flex flex-wrap gap-2 rounded-md border p-2 min-h-[40px]">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  disabled={hasSoftStop}
                  onClick={() => toggleMulti("staff_ids", u.id)}
                  className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                    form.staff_ids.includes(u.id)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground"
                  } disabled:opacity-50`}
                >
                  {u.name}{u.role ? ` · ${u.role.name}` : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Assign Resources</Label>
            <div className="flex flex-wrap gap-2 rounded-md border p-2 min-h-[40px]">
              {resources.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={hasSoftStop}
                  onClick={() => toggleMulti("resource_ids", r.id)}
                  className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                    form.resource_ids.includes(r.id)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground"
                  } disabled:opacity-50`}
                >
                  {r.name} ({r.resource_type})
                </button>
              ))}
            </div>
          </div>

          {/* Hard stop */}
          {error?.type === "hard_stop" && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-semibold">
                <ShieldAlert className="h-4 w-4" />
                Booking Blocked — Hard Stop
              </div>
              {error.violations.map((v) => (
                <p key={v.rule_id} className="text-sm text-destructive">{v.description}</p>
              ))}
            </div>
          )}

          {error?.type === "generic" && (
            <p className="text-sm text-destructive">{error.message}</p>
          )}

          {/* Soft stop override flow */}
          {hasSoftStop && (
            <div className="rounded-md border border-amber-400 bg-amber-50 p-3 space-y-3">
              <div className="flex items-center gap-2 text-amber-700 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Scheduling Warning — Override Required
              </div>
              {softViolations.map((v) => (
                <div key={v.rule_id} className="flex items-start gap-2">
                  <Badge variant="outline" className="border-amber-400 text-amber-700 shrink-0">
                    Soft Stop
                  </Badge>
                  <p className="text-sm text-amber-800">{v.description}</p>
                </div>
              ))}
              <div className="space-y-1 pt-1">
                <Label className="text-amber-700">
                  Who is authorizing this override? (required for audit log)
                </Label>
                <Select value={overridingUserId} onValueChange={setOverridingUserId}>
                  <SelectTrigger className="border-amber-400">
                    <SelectValue placeholder="Select authorizing staff member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}{u.role ? ` · ${u.role.name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>

          {!hasSoftStop ? (
            <Button
              onClick={() => submitBooking(false)}
              disabled={submitting || !form.service_id || !form.start_time || !form.client_name || !form.patient_name}
            >
              {submitting ? "Booking…" : "Book Appointment"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => { setSoftViolations(null); setOverridingUserId(""); }}>
                Go Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => submitBooking(true)}
                disabled={submitting || !overridingUserId}
              >
                {submitting ? "Saving…" : "Override & Book"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
