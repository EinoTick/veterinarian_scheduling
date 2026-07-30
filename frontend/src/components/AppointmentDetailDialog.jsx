import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { useClinicTimezone } from "@/hooks/useClinicTimezone";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { readErrorMessage, readJson } from "@/lib/http";
import { formatInClinic } from "@/lib/datetime";
import { APPOINTMENT_STATUS_VARIANT as STATUS_VARIANT } from "@/lib/constants";
import BookingModal from "@/components/BookingModal";

/**
 * Detail + status actions + edit for a calendar event / appointment.
 */
export default function AppointmentDetailDialog({
  appointmentId,
  open,
  onClose,
  onChanged,
  seed = null,
}) {
  const { apiFetch } = useAuth();
  const { services, staff, resources, ensure } = useCatalog();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [appt, setAppt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const clinicTz = useClinicTimezone(appt?.clinic_id ?? seed?.clinic_id ?? null);

  useEffect(() => {
    if (!open || !appointmentId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setAppt(null);
    setEditOpen(false);
    ensure(["services", "staff", "resources", "clinics"]).catch(() => {});

    (async () => {
      try {
        const res = await apiFetch(`/api/appointments/${appointmentId}`);
        if (!active) return;
        if (!res.ok) {
          setError(await readErrorMessage(res, "Failed to load appointment."));
          return;
        }
        setAppt(await res.json());
      } catch {
        if (active) setError("Network error — is the backend running?");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [open, appointmentId, apiFetch, ensure]);

  const serviceName =
    seed?.service_name
    ?? services.find((s) => s.id === appt?.service_id)?.name
    ?? null;

  async function setStatus(status) {
    if (!appt) return;
    if (status === "cancelled") {
      if (!(await confirm({
        title: "Cancel appointment?",
        description: "Cancel this appointment?",
        destructive: true,
        confirmLabel: "Cancel appointment",
      }))) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = status === "cancelled"
        ? await apiFetch(`/api/appointments/${appt.id}/cancel`, { method: "POST" })
        : await apiFetch(`/api/appointments/${appt.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status }),
          });
      if (!res.ok) {
        setError(await readErrorMessage(res, "Status update failed."));
        return;
      }
      const updated = await readJson(res);
      setAppt(updated);
      onChanged?.(updated);
    } catch {
      setError("Network error — is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  const display = appt ?? seed;
  const status = appt?.status ?? seed?.status ?? "scheduled";
  const allocations = appt?.allocations ?? [];

  function personName(userId) {
    const u = staff.find((s) => s.id === userId);
    return u ? `${u.name}${u.role ? ` · ${u.role.name}` : ""}` : `Staff #${userId}`;
  }

  function resourceName(resourceId) {
    const r = resources.find((x) => x.id === resourceId);
    return r ? `${r.name} (${r.resource_type})` : `Resource #${resourceId}`;
  }

  return (
    <>
      <Dialog open={open && !editOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Appointment</DialogTitle>
          </DialogHeader>

          {loading && !display ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : error && !display ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : display ? (
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{display.patient_name}</p>
                <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Times in {clinicTz}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Client</dt>
                <dd>{display.client_name || "—"}</dd>
                <dt className="text-muted-foreground">Service</dt>
                <dd>{serviceName || seed?.service_name || `Service #${display.service_id ?? "—"}`}</dd>
                <dt className="text-muted-foreground">Start</dt>
                <dd>{formatInClinic(display.start_time ?? seed?.start_time, clinicTz)}</dd>
                <dt className="text-muted-foreground">End</dt>
                <dd>{formatInClinic(display.end_time ?? seed?.end_time, clinicTz)}</dd>
                {seed?.presence_type && (
                  <>
                    <dt className="text-muted-foreground">Presence</dt>
                    <dd>{seed.presence_type.replaceAll("_", " ")}</dd>
                  </>
                )}
              </dl>

              {allocations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Allocations
                  </p>
                  <ul className="space-y-1 text-sm">
                    {allocations.map((a) => (
                      <li
                        key={a.id}
                        className="rounded-md border bg-muted/30 px-2 py-1.5 flex justify-between gap-2"
                      >
                        <span>
                          {a.user_id
                            ? personName(a.user_id)
                            : resourceName(a.resource_id)}
                          {a.presence_type ? (
                            <span className="text-muted-foreground">
                              {" "}· {a.presence_type.replaceAll("_", " ")}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          +{a.start_offset_minutes ?? 0}m
                          {a.duration_minutes != null ? ` / ${a.duration_minutes}m` : " / full"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(appt?.overrides ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Overrides
                  </p>
                  <ul className="space-y-1 text-sm">
                    {appt.overrides.map((o) => (
                      <li key={o.id} className="rounded-md border px-2 py-1.5">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">
                            {(o.override_type || "").replaceAll("_", " ")}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatInClinic(o.timestamp, clinicTz)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          by {o.authorizer_name || `#${o.overridden_by_user_id}`}
                          {o.rule_description ? ` · ${o.rule_description}` : ""}
                          {o.notes ? ` · ${o.notes}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          ) : null}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {status === "scheduled" && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busy || loading || !appt}
                  onClick={() => setEditOpen(true)}
                >
                  Edit / Reschedule
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => setStatus("completed")}
                >
                  Complete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => setStatus("no_show")}
                >
                  No-show
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy || loading}
                  onClick={() => setStatus("cancelled")}
                >
                  Cancel
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BookingModal
        open={editOpen}
        appointment={appt}
        onClose={() => setEditOpen(false)}
        onBooked={(updated) => {
          setAppt(updated);
          setEditOpen(false);
          onChanged?.(updated);
        }}
      />

      <ConfirmDialog />
    </>
  );
}
