import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";

const NONE = "__none__";

const PRESENCE_TYPES = [
  { value: NONE, label: "Any presence" },
  { value: "IN_ROOM", label: "In Room" },
  { value: "IN_BUILDING", label: "In Building" },
  { value: "REMOTE", label: "Remote" },
];

const RESOURCE_TYPES = [
  { value: NONE, label: "None" },
  { value: "room", label: "Any room" },
  { value: "equipment", label: "Any equipment" },
];

const RESOURCE_CATEGORIES = [
  { value: NONE, label: "None" },
  { value: "exam_room", label: "Exam room" },
  { value: "dental_suite", label: "Dental suite" },
  { value: "surgery_suite", label: "Surgery suite" },
  { value: "imaging", label: "Imaging" },
];

const WEEKDAYS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

const EMPTY_FORM = {
  clinic_id: "",
  service_id: "",
  required_role_id: NONE,
  alternative_role_ids: [],
  required_resource_id: NONE,
  required_resource_type: NONE,
  required_resource_category: NONE,
  min_quantity: "1",
  is_hard_stop: false,
  description: "",
  duration_minutes: "",
  start_offset_minutes: "0",
  presence_type: NONE,
  active_weekdays: [],
  active_start_time: "",
  active_end_time: "",
};

function ruleToForm(rule) {
  return {
    clinic_id: rule.clinic_id != null ? String(rule.clinic_id) : "",
    service_id: String(rule.service_id),
    required_role_id: rule.required_role_id != null ? String(rule.required_role_id) : NONE,
    alternative_role_ids: (rule.alternative_role_ids ?? []).map(String),
    required_resource_id: rule.required_resource_id != null ? String(rule.required_resource_id) : NONE,
    required_resource_type: rule.required_resource_type ?? NONE,
    required_resource_category: rule.required_resource_category ?? NONE,
    min_quantity: String(rule.min_quantity ?? 1),
    is_hard_stop: !!rule.is_hard_stop,
    description: rule.description ?? "",
    duration_minutes: rule.duration_minutes != null ? String(rule.duration_minutes) : "",
    start_offset_minutes: String(rule.start_offset_minutes ?? 0),
    presence_type: rule.presence_type ?? NONE,
    active_weekdays: rule.active_weekdays ?? [],
    active_start_time: rule.active_start_time ?? "",
    active_end_time: rule.active_end_time ?? "",
  };
}

export default function CreateRuleModal({ open, onClose, onSaved, rule = null }) {
  const { apiFetch, user } = useAuth();
  const {
    services: allServices,
    roles: allRoles,
    resources: allResources,
    clinics,
    ensure,
    invalidate,
    forClinic,
  } = useCatalog();
  const isEdit = !!rule;
  const isSystemAdmin = user?.system_role === "SYSTEM_ADMIN";

  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const keys = ["services", "roles", "resources"];
    if (isSystemAdmin) keys.push("clinics");
    ensure(keys).catch(() => {});
    setForm(rule ? ruleToForm(rule) : EMPTY_FORM);
    setError(null);
  }, [open, rule, ensure, isSystemAdmin]);

  const clinicId = isSystemAdmin
    ? (form.clinic_id || (rule?.clinic_id != null ? String(rule.clinic_id) : ""))
    : null;
  const services = useMemo(
    () => (isSystemAdmin ? forClinic(allServices, clinicId) : allServices),
    [allServices, clinicId, forClinic, isSystemAdmin]
  );
  const resources = useMemo(
    () => (isSystemAdmin ? forClinic(allResources, clinicId) : allResources),
    [allResources, clinicId, forClinic, isSystemAdmin]
  );
  const roles = useMemo(() => {
    if (!isSystemAdmin || !clinicId) return allRoles;
    const cid = Number(clinicId);
    return allRoles.filter((r) => r.clinic_id == null || r.clinic_id === cid);
  }, [allRoles, clinicId, isSystemAdmin]);

  function handleClose() {
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }

  function toggleWeekday(day) {
    setForm((f) => {
      const set = new Set(f.active_weekdays);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...f, active_weekdays: [...set].sort() };
    });
  }

  function toggleAltRole(roleId) {
    const id = String(roleId);
    setForm((f) => {
      const set = new Set(f.alternative_role_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...f, alternative_role_ids: [...set] };
    });
  }

  function buildBody() {
    const body = {
      service_id: Number(form.service_id),
      is_hard_stop: form.is_hard_stop,
      description: form.description,
      min_quantity: Number(form.min_quantity) || 1,
      start_offset_minutes: Number(form.start_offset_minutes) || 0,
    };

    if (!isEdit && isSystemAdmin && form.clinic_id) {
      body.clinic_id = Number(form.clinic_id);
    }

    if (form.required_role_id !== NONE) body.required_role_id = Number(form.required_role_id);
    else if (isEdit) body.clear_required_role_id = true;

    if (form.alternative_role_ids.length) {
      body.alternative_role_ids = form.alternative_role_ids.map(Number);
    } else if (isEdit) {
      body.clear_alternative_role_ids = true;
    }

    if (form.required_resource_id !== NONE) {
      body.required_resource_id = Number(form.required_resource_id);
      // Specific resource excludes type/category
      if (isEdit) {
        body.clear_required_resource_type = true;
        body.clear_required_resource_category = true;
      }
    } else if (isEdit) {
      body.clear_required_resource_id = true;
    }

    if (form.required_resource_id === NONE) {
      if (form.required_resource_type !== NONE) body.required_resource_type = form.required_resource_type;
      else if (isEdit) body.clear_required_resource_type = true;

      if (form.required_resource_category !== NONE) body.required_resource_category = form.required_resource_category;
      else if (isEdit) body.clear_required_resource_category = true;
    }

    if (form.duration_minutes !== "") body.duration_minutes = Number(form.duration_minutes);
    else if (isEdit) body.clear_duration_minutes = true;

    if (form.presence_type !== NONE) body.presence_type = form.presence_type;
    else if (isEdit) body.clear_presence_type = true;

    if (form.active_weekdays.length) body.active_weekdays = form.active_weekdays;
    else if (isEdit) body.clear_active_weekdays = true;

    if (form.active_start_time) body.active_start_time = form.active_start_time;
    else if (isEdit) body.clear_active_start_time = true;

    if (form.active_end_time) body.active_end_time = form.active_end_time;
    else if (isEdit) body.clear_active_end_time = true;

    if (!isEdit) {
      Object.keys(body).forEach((k) => {
        if (k.startsWith("clear_")) delete body[k];
      });
    }

    return body;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const body = buildBody();
    let res;
    try {
      res = await apiFetch(isEdit ? `/api/rules/${rule.id}` : "/api/rules", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
    } catch {
      setSubmitting(false);
      setError("Network error — is the backend running?");
      return;
    }

    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? "Failed to save rule.");
      return;
    }

    invalidate(["rules"]);
    handleClose();
    onSaved?.();
  }

  const hasConstraint =
    form.required_role_id !== NONE ||
    form.alternative_role_ids.length > 0 ||
    form.required_resource_id !== NONE ||
    form.required_resource_type !== NONE ||
    form.required_resource_category !== NONE;

  const canSubmit =
    form.service_id &&
    form.description &&
    hasConstraint &&
    (!isSystemAdmin || isEdit || form.clinic_id);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Scheduling Rule" : "Create Scheduling Rule"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSystemAdmin && !isEdit && (
            <div className="space-y-1">
              <Label>Clinic</Label>
              <Select
                value={form.clinic_id}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    clinic_id: v,
                    service_id: "",
                    required_resource_id: NONE,
                  }))
                }
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

          <div className="space-y-1">
            <Label>Service</Label>
            <Select
              value={form.service_id}
              onValueChange={(v) => setForm((f) => ({ ...f, service_id: v }))}
              required
            >
              <SelectTrigger><SelectValue placeholder="Select service…" /></SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Required Role</Label>
            <Select
              value={form.required_role_id}
              onValueChange={(v) => setForm((f) => ({ ...f, required_role_id: v }))}
            >
              <SelectTrigger><SelectValue placeholder="No primary role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Alternative Roles (OR)</Label>
            <p className="text-xs text-muted-foreground">Any of these also satisfy the role requirement.</p>
            <div className="flex flex-wrap gap-2 rounded-md border p-2">
              {roles.map((r) => {
                const id = String(r.id);
                const active = form.alternative_role_ids.includes(id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleAltRole(r.id)}
                    className={`rounded px-2 py-0.5 text-xs border ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Specific Resource</Label>
              <Select
                value={form.required_resource_id}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    required_resource_id: v,
                    // Mutually exclusive with type/category
                    ...(v !== NONE
                      ? { required_resource_type: NONE, required_resource_category: NONE }
                      : {}),
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {resources.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name} ({r.resource_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Min Quantity</Label>
              <Input
                type="number"
                min="1"
                value={form.min_quantity}
                onChange={(e) => setForm((f) => ({ ...f, min_quantity: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Applies to roles when a role is set; otherwise to resources.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Resource Type</Label>
              <Select
                value={form.required_resource_type}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    required_resource_type: v,
                    ...(v !== NONE ? { required_resource_id: NONE } : {}),
                  }))
                }
                disabled={form.required_resource_id !== NONE}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Resource Category</Label>
              <Select
                value={form.required_resource_category}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    required_resource_category: v,
                    ...(v !== NONE ? { required_resource_id: NONE } : {}),
                  }))
                }
                disabled={form.required_resource_id !== NONE}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_CATEGORIES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Timing & Presence
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Offset (min)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.start_offset_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, start_offset_minutes: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duration (min)</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Full"
                  value={form.duration_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Presence</Label>
                <Select
                  value={form.presence_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, presence_type: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESENCE_TYPES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave duration blank to only require that the role/resource is allocated at all.
              Set offset+duration to require coverage of that window (e.g. first 20 minutes).
            </p>
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Day / Time Scope
            </p>
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => {
                const active = form.active_weekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleWeekday(d.value)}
                    className={`rounded px-2 py-1 text-xs border ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Leave all unselected = every day.</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Active from</Label>
                <Input
                  type="time"
                  value={form.active_start_time}
                  onChange={(e) => setForm((f) => ({ ...f, active_start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Active until</Label>
                <Input
                  type="time"
                  value={form.active_end_time}
                  onChange={(e) => setForm((f) => ({ ...f, active_end_time: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Dental Cleaning requires a Licensed Tech"
              required
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="hard-stop"
              checked={form.is_hard_stop}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_hard_stop: v }))}
            />
            <Label htmlFor="hard-stop">
              Hard Stop{" "}
              <span className="text-xs text-muted-foreground">
                (blocks booking; otherwise shows override warning)
              </span>
            </Label>
          </div>

          {error && (
            <p className="text-sm text-destructive">
              {typeof error === "string" ? error : JSON.stringify(error)}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
            <Button type="submit" disabled={submitting || !canSubmit}>
              {submitting ? "Saving…" : isEdit ? "Update Rule" : "Save Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

