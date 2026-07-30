import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BookingModal from "@/components/BookingModal";
import AppointmentDetailDialog from "@/components/AppointmentDetailDialog";
import { Plus } from "lucide-react";
import { readErrorMessage } from "@/lib/http";
import {
  clinicDayEndExclusiveIso,
  clinicDayStartIso,
  formatInClinic,
} from "@/lib/datetime";
import { useClinicTimezone } from "@/hooks/useClinicTimezone";
import { APPOINTMENT_STATUS_VARIANT as STATUS_VARIANT } from "@/lib/constants";
import { DateTime } from "luxon";

function defaultRange(clinicTz) {
  const now = DateTime.now().setZone(clinicTz).startOf("day");
  return {
    start: now.minus({ days: 120 }).toISODate(),
    end: now.plus({ days: 60 }).toISODate(),
  };
}

const PAGE_SIZE = 50;

export default function BookingsPage() {
  const { apiFetch } = useAuth();
  const { services, ensure } = useCatalog();
  const clinicTz = useClinicTimezone();
  const [appointments, setAppointments] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rangeStart, setRangeStart] = useState(() => defaultRange("UTC").start);
  const [rangeEnd, setRangeEnd] = useState(() => defaultRange("UTC").end);

  const loadData = useCallback(async () => {
    if (rangeStart > rangeEnd) {
      setLoadError("Start date must be on or before end date.");
      return;
    }
    const startIso = clinicDayStartIso(rangeStart, clinicTz);
    const endIso = clinicDayEndExclusiveIso(rangeEnd, clinicTz);

    const qs = new URLSearchParams({
      include_cancelled: String(showCancelled),
      start: startIso,
      end: endIso,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

    try {
      try {
        await ensure(["services", "clinics"]);
      } catch {
        /* catalog banner surfaces partial failures */
      }
      const apptsRes = await apiFetch(`/api/appointments?${qs}`);
      if (!apptsRes.ok) {
        setLoadError(await readErrorMessage(apptsRes, "Failed to load appointments."));
        return;
      }

      setLoadError(null);
      const body = await apptsRes.json();
      if (Array.isArray(body)) {
        setAppointments(body);
        setTotal(body.length);
      } else {
        setAppointments(body.items ?? []);
        setTotal(body.total ?? 0);
      }
    } catch {
      setLoadError("Failed to load appointments.");
    }
  }, [apiFetch, ensure, showCancelled, rangeStart, rangeEnd, offset, clinicTz]);

  useEffect(() => { loadData(); }, [loadData]);

  const serviceName = (id) => services.find((s) => s.id === id)?.name ?? `Service #${id}`;

  async function setStatus(appt, status) {
    if (status === "cancelled") {
      const ok = window.confirm("Cancel this appointment?");
      if (!ok) return;
    }
    setBusyId(appt.id);
    setLoadError(null);
    try {
      const res = status === "cancelled"
        ? await apiFetch(`/api/appointments/${appt.id}/cancel`, { method: "POST" })
        : await apiFetch(`/api/appointments/${appt.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status }),
          });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoadError(typeof err.detail === "string" ? err.detail : "Status update failed.");
        return;
      }
      await loadData();
    } finally {
      setBusyId(null);
    }
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Bookings</h2>
          <p className="text-sm text-muted-foreground">
            View and manage appointments (times in {clinicTz})
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="range-start" className="text-sm text-muted-foreground">From</Label>
            <Input
              id="range-start"
              type="date"
              value={rangeStart}
              onChange={(e) => { setOffset(0); setRangeStart(e.target.value); }}
              className="w-auto"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="range-end" className="text-sm text-muted-foreground">To</Label>
            <Input
              id="range-end"
              type="date"
              value={rangeEnd}
              onChange={(e) => { setOffset(0); setRangeEnd(e.target.value); }}
              className="w-auto"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-cancelled" checked={showCancelled} onCheckedChange={(v) => { setOffset(0); setShowCancelled(v); }} />
            <Label htmlFor="show-cancelled" className="text-sm text-muted-foreground">Show cancelled</Label>
          </div>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Appointments</CardTitle>
          <p className="text-sm text-muted-foreground">
            {total === 0 ? "0 results" : `${pageStart}–${pageEnd} of ${total}`}
          </p>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments in this date range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Patient</th>
                    <th className="pb-2 pr-4">Client</th>
                    <th className="pb-2 pr-4">Service</th>
                    <th className="pb-2 pr-4">Start</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr
                      key={a.id}
                      className={`border-b last:border-0 cursor-pointer hover:bg-muted/40 ${a.status === "cancelled" ? "opacity-50" : ""}`}
                      onClick={() => setDetailId(a.id)}
                    >
                      <td className="py-2 pr-4 font-medium">{a.patient_name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{a.client_name}</td>
                      <td className="py-2 pr-4">{serviceName(a.service_id)}</td>
                      <td className="py-2 pr-4">{formatInClinic(a.start_time, clinicTz)}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>{a.status}</Badge>
                      </td>
                      <td className="py-2" onClick={(e) => e.stopPropagation()}>
                        {a.status === "scheduled" && (
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={busyId === a.id}
                              onClick={() => setStatus(a, "completed")}
                            >
                              Complete
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={busyId === a.id}
                              onClick={() => setStatus(a, "no_show")}
                            >
                              No-show
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive"
                              disabled={busyId === a.id}
                              onClick={() => setStatus(a, "cancelled")}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(canPrev || canNext) && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canPrev}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canNext}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <BookingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onBooked={() => loadData()}
      />

      <AppointmentDetailDialog
        appointmentId={detailId}
        open={detailId != null}
        onClose={() => setDetailId(null)}
        onChanged={() => loadData()}
      />
    </div>
  );
}
