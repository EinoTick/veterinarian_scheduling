import { useEffect, useMemo, useRef, useState } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, ShieldAlert, Plus, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { useClinicTimezone } from "@/hooks/useClinicTimezone";
import {
  formatInClinic,
  toClinicDatetimeValue,
  isPastClinicDatetime,
  clinicDatetimeToUtcIso,
  utcIsoToClinicDatetimeValue,
  normalizeClinicTz,
} from "@/lib/datetime";
import { PRESENCE_TYPE_OPTIONS as PRESENCE_TYPES } from "@/lib/constants";
import { detailMessage, errorCode, readJson } from "@/lib/http";

const EMPTY_FORM = {
  clinic_id: "",
  service_id: "",
  start_time: "",
  client_id: "",
  patient_id: "",
  staff_allocations: [],
  resource_allocations: [],
};

/**
 * One staff- or resource-allocation row. Shared between the staff and
 * resource lists (they only differ by whether a presence-type selector is
 * shown) so the two ~70-line near-identical blocks don't drift out of sync.
 */
function AllocationRow({
  options,
  optionLabel,
  value,
  onSelectChange,
  selectPlaceholder,
  presenceValue,
  onPresenceChange,
  offsetValue,
  onOffsetChange,
  durationValue,
  onDurationChange,
  onRemove,
  disabled,
}) {
  return (
    <div className="flex gap-2 items-center rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="flex-1 min-w-0">
        <Select value={value} onValueChange={onSelectChange} disabled={disabled}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder={selectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>{optionLabel(o)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {onPresenceChange && (
        <div className="w-28">
          <Select value={presenceValue} onValueChange={onPresenceChange} disabled={disabled}>
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
      )}
      <Input
        type="number"
        min="0"
        placeholder="0"
        value={offsetValue}
        onChange={onOffsetChange}
        disabled={disabled}
        className="h-7 w-14 text-xs text-center"
      />
      <Input
        type="number"
        min="1"
        placeholder="Full"
        value={durationValue}
        onChange={onDurationChange}
        disabled={disabled}
        className="h-7 w-14 text-xs text-center"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove allocation"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function formFromAppointment(appt, clinicTz, newRowKey) {
  const staff_allocations = [];
  const resource_allocations = [];
  for (const a of appt.allocations || []) {
    if (a.user_id != null) {
      staff_allocations.push({
        _key: newRowKey(),
        user_id: String(a.user_id),
        presence_type: a.presence_type || "IN_ROOM",
        start_offset_minutes: a.start_offset_minutes ?? 0,
        duration_minutes: a.duration_minutes != null ? a.duration_minutes : "",
      });
    } else if (a.resource_id != null) {
      resource_allocations.push({
        _key: newRowKey(),
        resource_id: String(a.resource_id),
        start_offset_minutes: a.start_offset_minutes ?? 0,
        duration_minutes: a.duration_minutes != null ? a.duration_minutes : "",
      });
    }
  }
  return {
    clinic_id: appt.clinic_id != null ? String(appt.clinic_id) : "",
    service_id: appt.service_id != null ? String(appt.service_id) : "",
    start_time: utcIsoToClinicDatetimeValue(appt.start_time, clinicTz),
    client_id: appt.client_id != null ? String(appt.client_id) : "",
    patient_id: appt.patient_id != null ? String(appt.patient_id) : "",
    staff_allocations,
    resource_allocations,
  };
}

export default function BookingModal({ open, onClose, onBooked, appointment = null }) {
  const { apiFetch, user } = useAuth();
  const {
    services: allServices,
    staff: allStaff,
    resources: allResources,
    rules: allRules,
    clinics,
    clients: allClients,
    ensure,
    forClinic,
    invalidate,
  } = useCatalog();
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";
  const isOverrideAdmin = user?.system_role === "CLINIC_ADMIN" || user?.system_role === "SYSTEM_ADMIN";
  const isEdit = Boolean(appointment?.id);

  const [form, setForm] = useState(EMPTY_FORM);
  const [softViolations, setSoftViolations] = useState(null);
  const [overridingUserId, setOverridingUserId] = useState("");
  const [doubleBookingConflicts, setDoubleBookingConflicts] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [livePreview, setLivePreview] = useState(null);
  const clinicTz = useClinicTimezone(form.clinic_id || null);
  const [minStart, setMinStart] = useState(() => toClinicDatetimeValue(new Date(), "UTC"));
  // Stable per-row identity for React keys — array index breaks once a row
  // in the middle of the list is removed.
  const nextRowKey = useRef(0);
  const newRowKey = () => (nextRowKey.current += 1);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      let cache = null;
      try {
        cache = await ensure(["services", "staff", "resources", "rules", "clinics", "clients"]);
      } catch {
        /* catalog may partially load; form still usable */
      }
      if (cancelled) return;

      setSoftViolations(null);
      setOverridingUserId("");
      setDoubleBookingConflicts(null);
      setError(null);
      setLivePreview(null);
      nextRowKey.current = 0;

      if (appointment?.id) {
        const clinicsList = cache?.clinics ?? clinics;
        const clinic = clinicsList.find((c) => c.id === appointment.clinic_id);
        const tz = normalizeClinicTz(clinic?.timezone || clinicTz);
        setForm(formFromAppointment(appointment, tz, newRowKey));
        setMinStart(toClinicDatetimeValue(new Date(), tz));
      } else {
        setForm(EMPTY_FORM);
        setMinStart(toClinicDatetimeValue(new Date(), clinicTz));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id, ensure]);

  const clinicFilter = isSystemAdmin ? form.clinic_id : null;
  const services = useMemo(
    () => (isSystemAdmin ? forClinic(allServices, clinicFilter) : allServices),
    [allServices, clinicFilter, forClinic, isSystemAdmin]
  );
  const users = useMemo(
    () => (isSystemAdmin ? forClinic(allStaff, clinicFilter) : allStaff),
    [allStaff, clinicFilter, forClinic, isSystemAdmin]
  );
  const resources = useMemo(
    () => (isSystemAdmin ? forClinic(allResources, clinicFilter) : allResources),
    [allResources, clinicFilter, forClinic, isSystemAdmin]
  );
  const rules = useMemo(
    () => (isSystemAdmin ? forClinic(allRules, clinicFilter) : allRules),
    [allRules, clinicFilter, forClinic, isSystemAdmin]
  );
  const clients = useMemo(
    () =>
      (isSystemAdmin ? forClinic(allClients, clinicFilter) : allClients).filter(
        (c) => c.is_active !== false
      ),
    [allClients, clinicFilter, forClinic, isSystemAdmin]
  );

  const selectedClient = useMemo(
    () => clients.find((c) => String(c.id) === String(form.client_id)) ?? null,
    [clients, form.client_id]
  );
  const patients = useMemo(
    () => (selectedClient?.patients ?? []).filter((p) => p.is_active !== false),
    [selectedClient]
  );

  function resetState() {
    setForm(EMPTY_FORM);
    setSoftViolations(null);
    setOverridingUserId("");
    setDoubleBookingConflicts(null);
    setError(null);
    setLivePreview(null);
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
        { _key: newRowKey(), user_id: "", presence_type: "IN_ROOM", start_offset_minutes: 0, duration_minutes: "" },
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

  function staffOptionsForRow(idx) {
    const taken = new Set(
      form.staff_allocations
        .map((r, i) => (i !== idx && r.user_id ? String(r.user_id) : null))
        .filter(Boolean)
    );
    return users.filter((u) => !taken.has(String(u.id)));
  }

  function resourceOptionsForRow(idx) {
    const taken = new Set(
      form.resource_allocations
        .map((r, i) => (i !== idx && r.resource_id ? String(r.resource_id) : null))
        .filter(Boolean)
    );
    return resources.filter((r) => !taken.has(String(r.id)));
  }

  function addResourceRow() {
    setForm((f) => ({
      ...f,
      resource_allocations: [
        ...f.resource_allocations,
        { _key: newRowKey(), resource_id: "", start_offset_minutes: 0, duration_minutes: "" },
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

  function buildPayload({ overrideDoubleBooking = false, includeClinicId = !isEdit } = {}) {
    const softOverrideActive = softViolations !== null && !!overridingUserId;
    const doubleOverrideActive = overrideDoubleBooking && !!overridingUserId;
    return {
      ...(includeClinicId && isSystemAdmin && form.clinic_id
        ? { clinic_id: Number(form.clinic_id) }
        : {}),
      service_id: Number(form.service_id),
      start_time: clinicDatetimeToUtcIso(form.start_time, clinicTz),
      client_id: Number(form.client_id),
      patient_id: Number(form.patient_id),
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
      overriding_user_id:
        softOverrideActive || doubleOverrideActive ? Number(overridingUserId) : null,
      override_double_booking: doubleOverrideActive,
    };
  }

  // Live preview via /api/appointments/validate (debounced)
  useEffect(() => {
    if (!open) return;
    if (softViolations || doubleBookingConflicts) return;
    if (!form.service_id || !form.start_time || !form.client_id || !form.patient_id) {
      setLivePreview(null);
      return;
    }
    if (isSystemAdmin && !form.clinic_id) {
      setLivePreview(null);
      return;
    }
    if (isPastClinicDatetime(form.start_time, clinicTz)) {
      setLivePreview(null);
      return;
    }

    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch("/api/appointments/validate", {
          method: "POST",
          body: JSON.stringify(buildPayload({ includeClinicId: true })),
          signal: controller.signal,
        });
        if (!res.ok) {
          setLivePreview(null);
          return;
        }
        setLivePreview(await res.json());
      } catch (err) {
        // Aborted because a newer request superseded this one — let that
        // one own the state update instead of clobbering it with null.
        if (err?.name === "AbortError") return;
        setLivePreview(null);
      }
    }, 400);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    form.clinic_id,
    form.service_id,
    form.start_time,
    form.client_id,
    form.patient_id,
    form.staff_allocations,
    form.resource_allocations,
    softViolations,
    doubleBookingConflicts,
    clinicTz,
  ]);

  async function submitBooking({ overrideDoubleBooking = false } = {}) {
    setSubmitting(true);
    setError(null);

    if (isPastClinicDatetime(form.start_time, clinicTz)) {
      setSubmitting(false);
      setError({ type: "generic", message: "Start time cannot be in the past." });
      return;
    }

    const staffIds = form.staff_allocations.map((a) => a.user_id).filter(Boolean);
    if (new Set(staffIds).size !== staffIds.length) {
      setSubmitting(false);
      setError({ type: "generic", message: "Each staff member can only be added once." });
      return;
    }

    const resourceIds = form.resource_allocations.map((a) => a.resource_id).filter(Boolean);
    if (new Set(resourceIds).size !== resourceIds.length) {
      setSubmitting(false);
      setError({ type: "generic", message: "Each resource can only be added once." });
      return;
    }

    let res;
    try {
      if (isEdit) {
        res = await apiFetch(`/api/appointments/${appointment.id}`, {
          method: "PATCH",
          body: JSON.stringify(buildPayload({ overrideDoubleBooking, includeClinicId: false })),
        });
      } else {
        res = await apiFetch("/api/appointments", {
          method: "POST",
          body: JSON.stringify(buildPayload({ overrideDoubleBooking, includeClinicId: true })),
        });
      }
    } catch {
      setSubmitting(false);
      setError({ type: "generic", message: "Network error — is the backend running?" });
      return;
    }

    setSubmitting(false);

    if (res.ok) {
      const appt = await res.json();
      invalidate(["clients"]);
      resetState();
      onBooked?.(appt);
      onClose();
      return;
    }

    const body = await readJson(res);
    const code = errorCode(body);
    const details = body?.error?.details || body?.detail;

    if (res.status === 422 && code === "soft_stop") {
      setSoftViolations(details?.violations || []);
      return;
    }
    if (res.status === 400 && code === "double_booking") {
      setDoubleBookingConflicts(details?.conflicts || []);
      return;
    }
    if (res.status === 400 && code === "hard_stop") {
      setError({ type: "hard_stop", violations: details?.violations || [] });
      return;
    }
    setError({
      type: "generic",
      message: detailMessage(body, "Booking failed."),
    });
  }

  const hasSoftStop = softViolations && softViolations.length > 0;
  const hasDoubleBooking = doubleBookingConflicts && doubleBookingConflicts.length > 0;
  const formLocked = hasSoftStop || hasDoubleBooking;
  const canSubmit =
    form.service_id && form.start_time && form.client_id && form.patient_id &&
    (!isSystemAdmin || form.clinic_id);

  // The backend only accepts overriding_user_id === current_user.id for
  // non-admins (you can't attribute an override to someone else without
  // proof they approved it) — so there's nothing for a non-admin to pick;
  // lock it to themselves as soon as an override panel appears.
  useEffect(() => {
    if (!isOverrideAdmin && (hasSoftStop || hasDoubleBooking) && user) {
      setOverridingUserId(String(user.id));
    }
  }, [isOverrideAdmin, hasSoftStop, hasDoubleBooking, user]);

  const primaryLabel = isEdit
    ? (submitting ? "Saving…" : "Save Changes")
    : (submitting ? "Booking…" : "Book Appointment");
  const overrideLabel = isEdit
    ? (submitting ? "Saving…" : "Override & Save")
    : (submitting ? "Saving…" : "Override & Book");
  const overrideDoubleLabel = isEdit
    ? (submitting ? "Saving…" : "Override & Save Anyway")
    : (submitting ? "Saving…" : "Override & Book Anyway");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Appointment" : "New Appointment"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isSystemAdmin && (
            <div className="space-y-1">
              <Label htmlFor="book-clinic">Clinic</Label>
              <Select
                value={form.clinic_id}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    clinic_id: v,
                    service_id: "",
                    client_id: "",
                    patient_id: "",
                    staff_allocations: [],
                    resource_allocations: [],
                  }))
                }
                disabled={formLocked || isEdit}
              >
                <SelectTrigger id="book-clinic"><SelectValue placeholder="Select clinic…" /></SelectTrigger>
                <SelectContent>
                  {clinics.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="book-service">Service</Label>
            <Select
              value={form.service_id}
              onValueChange={(v) => setForm((f) => ({ ...f, service_id: v }))}
              disabled={formLocked}
            >
              <SelectTrigger id="book-service"><SelectValue placeholder="Select service…" /></SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} ({s.default_duration_minutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.service_id && (() => {
            const serviceRules = rules.filter((r) => r.service_id === Number(form.service_id) && r.is_active !== false);
            if (!serviceRules.length) return null;
            return (
              <Alert>
                <AlertTitle className="uppercase tracking-wide text-muted-foreground">
                  Requirements for this service
                </AlertTitle>
                {serviceRules.map((r) => (
                  <div key={r.id} className="flex items-start gap-2">
                    <Badge variant={r.is_hard_stop ? "destructive" : "warning"} className="shrink-0">
                      {r.is_hard_stop ? "Required" : "Recommended"}
                    </Badge>
                    <p className="text-xs text-foreground leading-tight">{r.description}</p>
                  </div>
                ))}
              </Alert>
            );
          })()}

          <div className="space-y-1">
            <Label htmlFor="book-start">Start Time</Label>
            <Input
              id="book-start"
              type="datetime-local"
              value={form.start_time}
              min={minStart}
              onFocus={() => setMinStart(toClinicDatetimeValue(new Date(), clinicTz))}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
              disabled={formLocked}
            />
            <p className="text-xs text-muted-foreground">Times are in {clinicTz}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="book-client">Client</Label>
              {clients.length === 0 ? (
                <p className="text-xs text-muted-foreground rounded-md border border-dashed p-2">
                  No clients yet — add one under Clients.
                </p>
              ) : (
                <Select
                  value={form.client_id}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, client_id: v, patient_id: "" }))
                  }
                  disabled={formLocked || (isSystemAdmin && !form.clinic_id)}
                >
                  <SelectTrigger id="book-client"><SelectValue placeholder="Select client…" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}{c.email ? ` · ${c.email}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="book-patient">Patient</Label>
              <Select
                value={form.patient_id}
                onValueChange={(v) => setForm((f) => ({ ...f, patient_id: v }))}
                disabled={formLocked || !form.client_id}
              >
                <SelectTrigger id="book-patient"><SelectValue placeholder="Select patient…" /></SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}{p.species ? ` · ${p.species}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Staff Allocations</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStaffRow}
                disabled={formLocked || staffOptionsForRow(-1).length === 0}
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
                    <AllocationRow
                      key={row._key}
                      options={staffOptionsForRow(idx)}
                      optionLabel={(u) => `${u.name}${u.role ? ` · ${u.role.name}` : ""}`}
                      value={row.user_id}
                      onSelectChange={(v) => updateStaffRow(idx, "user_id", v)}
                      selectPlaceholder="Select staff…"
                      presenceValue={row.presence_type}
                      onPresenceChange={(v) => updateStaffRow(idx, "presence_type", v)}
                      offsetValue={row.start_offset_minutes}
                      onOffsetChange={(e) => updateStaffRow(idx, "start_offset_minutes", e.target.value)}
                      durationValue={row.duration_minutes}
                      onDurationChange={(e) => updateStaffRow(idx, "duration_minutes", e.target.value)}
                      onRemove={() => removeStaffRow(idx)}
                      disabled={formLocked}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Resource Allocations</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addResourceRow}
                disabled={formLocked || resourceOptionsForRow(-1).length === 0}
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
                    <AllocationRow
                      key={row._key}
                      options={resourceOptionsForRow(idx)}
                      optionLabel={(r) => `${r.name} (${r.resource_type})`}
                      value={row.resource_id}
                      onSelectChange={(v) => updateResourceRow(idx, "resource_id", v)}
                      selectPlaceholder="Select resource…"
                      offsetValue={row.start_offset_minutes}
                      onOffsetChange={(e) => updateResourceRow(idx, "start_offset_minutes", e.target.value)}
                      durationValue={row.duration_minutes}
                      onDurationChange={(e) => updateResourceRow(idx, "duration_minutes", e.target.value)}
                      onRemove={() => removeResourceRow(idx)}
                      disabled={formLocked}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {livePreview && !formLocked && !error && (
            <div className="space-y-2">
              {livePreview.hard_violations?.length > 0 && (
                <Alert variant="destructive">
                  <AlertTitle>Would be blocked</AlertTitle>
                  {livePreview.hard_violations.map((v) => (
                    <AlertDescription key={v.rule_id}>{v.description}</AlertDescription>
                  ))}
                </Alert>
              )}
              {livePreview.soft_violations?.length > 0 && (
                <Alert variant="warning">
                  <AlertTitle>Would need override</AlertTitle>
                  {livePreview.soft_violations.map((v) => (
                    <AlertDescription key={v.rule_id}>{v.description}</AlertDescription>
                  ))}
                </Alert>
              )}
              {livePreview.double_booking_conflicts?.length > 0 && (
                <Alert variant="destructive">
                  <AlertTitle>Double-booking risk</AlertTitle>
                  {livePreview.double_booking_conflicts.map((c, i) => (
                    <AlertDescription key={i}>
                      {c.entity} is already booked
                      {c.start_time && c.end_time
                        ? ` from ${formatInClinic(c.start_time, clinicTz)} to ${formatInClinic(c.end_time, clinicTz)}`
                        : ""}
                    </AlertDescription>
                  ))}
                </Alert>
              )}
              {livePreview.valid && (
                <Alert variant="success">
                  <AlertDescription>Looks good — no rule violations detected.</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {error?.type === "hard_stop" && (
            <Alert variant="destructive" className="p-3 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <ShieldAlert className="h-4 w-4" />
                Booking Blocked — Hard Stop
              </div>
              {error.violations.map((v) => (
                <AlertDescription key={v.rule_id} className="text-sm">{v.description}</AlertDescription>
              ))}
            </Alert>
          )}

          {error?.type === "generic" && (
            <p className="text-sm text-destructive">{error.message}</p>
          )}

          {hasDoubleBooking && (
            <Alert variant="destructive" className="border-2 p-3 space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertTriangle className="h-4 w-4" />
                Double-Booking Conflict Detected
              </div>
              {doubleBookingConflicts.map((c, i) => (
                <AlertDescription key={i} className="text-sm">
                  <strong>{c.entity}</strong> is already scheduled
                  {c.start_time && c.end_time
                    ? ` from ${formatInClinic(c.start_time, clinicTz)} to ${formatInClinic(c.end_time, clinicTz)}.`
                    : " during this time."}
                </AlertDescription>
              ))}
              <div className="space-y-1 pt-1">
                <Label>Who is authorizing this override? (required for audit log)</Label>
                {isOverrideAdmin ? (
                  <Select value={overridingUserId} onValueChange={setOverridingUserId}>
                    <SelectTrigger>
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
                ) : (
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {user?.name} (you) — only you or a clinic admin can authorize this.
                  </p>
                )}
              </div>
            </Alert>
          )}

          {hasSoftStop && !hasDoubleBooking && (
            <Alert variant="warning" className="p-3 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <AlertTriangle className="h-4 w-4" />
                Scheduling Warning — Override Required
              </div>
              {softViolations.map((v) => (
                <div key={v.rule_id} className="flex items-start gap-2">
                  <Badge variant="warning" className="shrink-0">Soft Stop</Badge>
                  <p className="text-sm">{v.description}</p>
                </div>
              ))}
              <div className="space-y-1 pt-1">
                <Label>Who is authorizing this override? (required for audit log)</Label>
                {isOverrideAdmin ? (
                  <Select value={overridingUserId} onValueChange={setOverridingUserId}>
                    <SelectTrigger>
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
                ) : (
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {user?.name} (you) — only you or a clinic admin can authorize this.
                  </p>
                )}
              </div>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>

          {!hasSoftStop && !hasDoubleBooking && (
            <Button
              onClick={() => submitBooking()}
              disabled={submitting || !canSubmit}
            >
              {primaryLabel}
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
                {overrideLabel}
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
                disabled={submitting || !overridingUserId}
              >
                {overrideDoubleLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
