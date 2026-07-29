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
import { AlertTriangle, ShieldAlert, Plus, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const PRESENCE_TYPES = [
  { value: "IN_ROOM", label: "In Room" },
  { value: "IN_BUILDING", label: "In Building" },
  { value: "REMOTE", label: "Remote" },
];

const EMPTY_FORM = {
  clinic_id: "",
  service_id: "",
  start_time: "",
  client_name: "",
  patient_name: "",
  staff_allocations: [],
  resource_allocations: [],
};

export default function BookingModal({ open, onClose, onBooked }) {
  const { apiFetch, user } = useAuth();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";

  const [services, setServices] = useState([]);
  const [users, setUsers] = useState([]);
  const [resources, setResources] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [rules, setRules] = useState([]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [softViolations, setSoftViolations] = useState(null);
  const [overridingUserId, setOverridingUserId] = useState("");
  const [doubleBookingConflicts, setDoubleBookingConflicts] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // On open: load clinics list (system admins only) once
  useEffect(() => {
    if (!open || !isSystemAdmin) return;
    apiFetch("/api/clinics")
      .then((r) => (r.ok ? r.json() : []))
      .then(setClinics)
      .catch(() => {});
  }, [open]);

  // Reload clinic-scoped data whenever the modal opens or the selected clinic changes.
  // For non-system-admins the backend already scopes by the caller's clinic, so we
  // only re-fetch on open.  For system admins we also re-fetch when form.clinic_id
  // changes so the dropdowns only show that clinic's staff/rooms/services.
  useEffect(() => {
    if (!open) return;
    if (isSystemAdmin && !form.clinic_id) return; // wait until clinic is chosen

    const safe = (r) => (r.ok ? r.json() : []);
    const qs = isSystemAdmin ? `?clinic_id=${form.clinic_id}` : "";
    Promise.all([
      apiFetch(`/api/services`).then(safe),
      apiFetch(`/api/users`).then(safe),
      apiFetch(`/api/resources`).then(safe),
      apiFetch(`/api/rules`).then(safe),
    ]).then(([s, u, res, r]) => {
      if (isSystemAdmin) {
        const cid = Number(form.clinic_id);
        setServices(s.filter((x) => x.clinic_id === cid));
        setResources(res.filter((x) => x.clinic_id === cid));
        // Users list from /api/users is already admin-scoped; filter by clinic_id field
        setUsers(u.filter((x) => x.clinic_id === cid));
        setRules(r.filter((x) => x.clinic_id === cid));
      } else {
        setServices(s);
        setUsers(u);
        setResources(res);
        setRules(r);
      }
    }).catch(() => {});
  }, [open, isSystemAdmin ? form.clinic_id : null]);

  function resetState() {
    setForm(EMPTY_FORM);
    setSoftViolations(null);
    setOverridingUserId("");
    setDoubleBookingConflicts(null);
    setError(null);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function addStaffRow() {
    setForm((f) => ({
      ...f,
      staff_allocations: [
        ...f.staff_allocations,
        { user_id: "", presence_type: "IN_ROOM", start_offset_minutes: 0, duration_minutes: "" },
      ],
    }));
  }

  function removeStaffRow(idx) {
    setForm((f) => ({
      ...f,
      staff_allocations: f.staff_allocations.filter((_, i) => i !== idx),
    }));
  }

  function updateStaffRow(idx, field, value) {
    setForm((f) => {
      const rows = [...f.staff_allocations];
      rows[idx] = { ...rows[idx], [field]: value };
      return { ...f, staff_allocations: rows };
    });
  }

  function addResourceRow() {
    setForm((f) => ({
      ...f,
      resource_allocations: [
        ...f.resource_allocations,
        { resource_id: "", start_offset_minutes: 0, duration_minutes: "" },
      ],
    }));
  }

  function removeResourceRow(idx) {
    setForm((f) => ({
      ...f,
      resource_allocations: f.resource_allocations.filter((_, i) => i !== idx),
    }));
  }

  function updateResourceRow(idx, field, value) {
    setForm((f) => {
      const rows = [...f.resource_allocations];
      rows[idx] = { ...rows[idx], [field]: value };
      return { ...f, resource_allocations: rows };
    });
  }

  function buildPayload({ overrideDoubleBooking = false } = {}) {
    const softOverrideActive = softViolations !== null && !!overridingUserId;
    return {
      ...(isSystemAdmin && form.clinic_id ? { clinic_id: Number(form.clinic_id) } : {}),
      service_id: Number(form.service_id),
      start_time: form.start_time,
      client_name: form.client_name,
      patient_name: form.patient_name,
      allocations: [
        ...form.staff_allocations
          .filter((a) => a.user_id)
          .map((a) => ({
            user_id: Number(a.user_id),
            presence_type: a.presence_type || null,
            start_offset_minutes: Number(a.start_offset_minutes) || 0,
            duration_minutes: a.duration_minutes !== "" ? Number(a.duration_minutes) : null,
          })),
        ...form.resource_allocations
          .filter((a) => a.resource_id)
          .map((a) => ({
            resource_id: Number(a.resource_id),
            start_offset_minutes: Number(a.start_offset_minutes) || 0,
            duration_minutes: a.duration_minutes !== "" ? Number(a.duration_minutes) : null,
          })),
      ],
      override: softOverrideActive,
      overriding_user_id: softOverrideActive ? Number(overridingUserId) : null,
      override_double_booking: overrideDoubleBooking,
    };
  }

  async function submitBooking({ overrideDoubleBooking = false } = {}) {
    setSubmitting(true);
    setError(null);

    let res;
    try {
      res = await apiFetch("/api/appointments", {
        method: "POST",
        body: JSON.stringify(buildPayload({ overrideDoubleBooking })),
      });
    } catch {
      setSubmitting(false);
      setError({ type: "generic", message: "Network error — is the backend running?" });
      return;
    }

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
    if (res.status === 400 && detail?.type === "double_booking") {
      setDoubleBookingConflicts(detail.conflicts);
      return;
    }
    if (res.status === 400 && detail?.type === "hard_stop") {
      setError({ type: "hard_stop", violations: detail.violations });
      return;
    }
    setError({ type: "generic", message: JSON.stringify(detail) });
  }

  const hasSoftStop = softViolations && softViolations.length > 0;
  const hasDoubleBooking = doubleBookingConflicts && doubleBookingConflicts.length > 0;
  const formLocked = hasSoftStop || hasDoubleBooking;
  const canSubmit =
    form.service_id && form.start_time && form.client_name && form.patient_name &&
    (!isSystemAdmin || form.clinic_id);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Appointment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Clinic — SYSTEM_ADMIN only */}
          {isSystemAdmin && (
            <div className="space-y-1">
              <Label>Clinic</Label>
              <Select
                value={form.clinic_id}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    clinic_id: v,
                    // Reset any selected staff/resources — they belong to the old clinic
                    service_id: "",
                    staff_allocations: [],
                    resource_allocations: [],
                  }))
                }
                disabled={formLocked}
              >
                <SelectTrigger><SelectValue placeholder="Select clinic…" /></SelectTrigger>
                <SelectContent>
                  {clinics.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Service */}
          <div className="space-y-1">
            <Label>Service</Label>
            <Select
              value={form.service_id}
              onValueChange={(v) => setForm((f) => ({ ...f, service_id: v }))}
              disabled={formLocked}
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

          {/* Service requirements */}
          {form.service_id && (() => {
            const serviceRules = rules.filter((r) => r.service_id === Number(form.service_id));
            if (!serviceRules.length) return null;
            return (
              <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Requirements for this service
                </p>
                {serviceRules.map((r) => (
                  <div key={r.id} className="flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className={r.is_hard_stop
                        ? "border-destructive text-destructive shrink-0"
                        : "border-amber-400 text-amber-700 shrink-0"}
                    >
                      {r.is_hard_stop ? "Required" : "Recommended"}
                    </Badge>
                    <p className="text-xs text-foreground leading-tight">{r.description}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Start Time */}
          <div className="space-y-1">
            <Label>Start Time</Label>
            <Input
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
              disabled={formLocked}
            />
          </div>

          {/* Client / Patient */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Client Name</Label>
              <Input
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                disabled={formLocked}
              />
            </div>
            <div className="space-y-1">
              <Label>Patient Name</Label>
              <Input
                value={form.patient_name}
                onChange={(e) => setForm((f) => ({ ...f, patient_name: e.target.value }))}
                disabled={formLocked}
              />
            </div>
          </div>

          {/* Staff Allocations */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Staff Allocations</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStaffRow}
                disabled={formLocked}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3 w-3" /> Add Staff
              </Button>
            </div>

            {form.staff_allocations.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed p-2 text-center">
                No staff added — click "Add Staff" to assign members with granular scheduling.
              </p>
            ) : (
              <>
                <div className="flex gap-2 px-2 text-xs text-muted-foreground">
                  <div className="flex-1">Staff Member</div>
                  <div className="w-28">Presence</div>
                  <div className="w-14 text-center" title="Minutes into appointment when they start">Offset</div>
                  <div className="w-14 text-center" title="How many minutes they are needed (blank = full appointment)">Dur.</div>
                  <div className="w-8" />
                </div>
                <div className="space-y-1.5">
                  {form.staff_allocations.map((row, idx) => (
                    <div
                      key={idx}
                      className="flex gap-2 items-center rounded-md border bg-muted/30 px-2 py-1.5"
                    >
                      <div className="flex-1 min-w-0">
                        <Select
                          value={row.user_id}
                          onValueChange={(v) => updateStaffRow(idx, "user_id", v)}
                          disabled={formLocked}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Select staff…" />
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
                      <div className="w-28">
                        <Select
                          value={row.presence_type}
                          onValueChange={(v) => updateStaffRow(idx, "presence_type", v)}
                          disabled={formLocked}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PRESENCE_TYPES.map((pt) => (
                              <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={row.start_offset_minutes}
                        onChange={(e) => updateStaffRow(idx, "start_offset_minutes", e.target.value)}
                        disabled={formLocked}
                        className="h-7 w-14 text-xs text-center"
                      />
                      <Input
                        type="number"
                        min="1"
                        placeholder="Full"
                        value={row.duration_minutes}
                        onChange={(e) => updateStaffRow(idx, "duration_minutes", e.target.value)}
                        disabled={formLocked}
                        className="h-7 w-14 text-xs text-center"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeStaffRow(idx)}
                        disabled={formLocked}
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Resource Allocations */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Resource Allocations</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addResourceRow}
                disabled={formLocked}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3 w-3" /> Add Resource
              </Button>
            </div>

            {form.resource_allocations.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed p-2 text-center">
                No resources added — click "Add Resource" to assign rooms or equipment.
              </p>
            ) : (
              <>
                <div className="flex gap-2 px-2 text-xs text-muted-foreground">
                  <div className="flex-1">Room / Equipment</div>
                  <div className="w-14 text-center" title="Minutes into appointment when needed">Offset</div>
                  <div className="w-14 text-center" title="How many minutes needed (blank = full appointment)">Dur.</div>
                  <div className="w-8" />
                </div>
                <div className="space-y-1.5">
                  {form.resource_allocations.map((row, idx) => (
                    <div
                      key={idx}
                      className="flex gap-2 items-center rounded-md border bg-muted/30 px-2 py-1.5"
                    >
                      <div className="flex-1 min-w-0">
                        <Select
                          value={row.resource_id}
                          onValueChange={(v) => updateResourceRow(idx, "resource_id", v)}
                          disabled={formLocked}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Select resource…" />
                          </SelectTrigger>
                          <SelectContent>
                            {resources.map((r) => (
                              <SelectItem key={r.id} value={String(r.id)}>
                                {r.name} ({r.resource_type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={row.start_offset_minutes}
                        onChange={(e) => updateResourceRow(idx, "start_offset_minutes", e.target.value)}
                        disabled={formLocked}
                        className="h-7 w-14 text-xs text-center"
                      />
                      <Input
                        type="number"
                        min="1"
                        placeholder="Full"
                        value={row.duration_minutes}
                        onChange={(e) => updateResourceRow(idx, "duration_minutes", e.target.value)}
                        disabled={formLocked}
                        className="h-7 w-14 text-xs text-center"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeResourceRow(idx)}
                        disabled={formLocked}
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
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

          {/* Double-booking warning */}
          {hasDoubleBooking && (
            <div className="rounded-md border-2 border-red-500 bg-red-50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-red-700 font-bold">
                <AlertTriangle className="h-4 w-4" />
                Double-Booking Conflict Detected
              </div>
              {doubleBookingConflicts.map((c, i) => (
                <p key={i} className="text-sm text-red-700">
                  <strong>{c.entity}</strong> is already scheduled during this time.
                </p>
              ))}
            </div>
          )}

          {/* Soft stop override */}
          {hasSoftStop && !hasDoubleBooking && (
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

          {!hasSoftStop && !hasDoubleBooking && (
            <Button
              onClick={() => submitBooking()}
              disabled={submitting || !canSubmit}
            >
              {submitting ? "Booking…" : "Book Appointment"}
            </Button>
          )}

          {hasSoftStop && !hasDoubleBooking && (
            <>
              <Button
                variant="outline"
                onClick={() => { setSoftViolations(null); setOverridingUserId(""); }}
              >
                Go Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => submitBooking()}
                disabled={submitting || !overridingUserId}
              >
                {submitting ? "Saving…" : "Override & Book"}
              </Button>
            </>
          )}

          {hasDoubleBooking && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setSoftViolations(null);
                  setOverridingUserId("");
                  setDoubleBookingConflicts(null);
                }}
              >
                Go Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => submitBooking({ overrideDoubleBooking: true })}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Override & Book Anyway"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
