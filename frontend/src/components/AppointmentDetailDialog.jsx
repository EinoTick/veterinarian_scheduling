import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { readErrorMessage, readJson } from "@/lib/http";

const STATUS_VARIANT = {
  scheduled: "secondary",
  completed: "success",
  cancelled: "outline",
  no_show: "destructive",
};

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Detail + status actions for a calendar event / appointment.
 * Loads full appointment via GET /api/appointments/:id when opened.
 */
export default function AppointmentDetailDialog({
  appointmentId,
  open,
  onClose,
  onChanged,
  seed = null,
}) {
  const { apiFetch } = useAuth();
  const { services, ensure } = useCatalog();
  const [appt, setAppt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !appointmentId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setAppt(null);
    ensure(["services"]).catch(() => {});

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
      const ok = window.confirm("Cancel this appointment?");
      if (!ok) return;
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
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
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Client</dt>
              <dd>{display.client_name || "—"}</dd>
              <dt className="text-muted-foreground">Service</dt>
              <dd>{serviceName || seed?.service_name || `Service #${display.service_id ?? "—"}`}</dd>
              <dt className="text-muted-foreground">Start</dt>
              <dd>{formatDateTime(display.start_time ?? seed?.start_time)}</dd>
              <dt className="text-muted-foreground">End</dt>
              <dd>{formatDateTime(display.end_time ?? seed?.end_time)}</dd>
              {seed?.presence_type && (
                <>
                  <dt className="text-muted-foreground">Presence</dt>
                  <dd>{seed.presence_type.replaceAll("_", " ")}</dd>
                </>
              )}
            </dl>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : null}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {status === "scheduled" && (
            <>
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
  );
}
