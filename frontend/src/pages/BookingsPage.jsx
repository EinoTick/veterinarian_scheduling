import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BookingModal from "@/components/BookingModal";
import { Plus } from "lucide-react";

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const STATUS_VARIANT = {
  scheduled: "secondary",
  completed: "default",
  cancelled: "outline",
  no_show: "destructive",
};

export default function BookingsPage() {
  const { apiFetch } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [services, setServices] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadData = useCallback(async () => {
    let apptsRes, servicesRes;
    try {
      [apptsRes, servicesRes] = await Promise.all([
        apiFetch(`/api/appointments?include_cancelled=${showCancelled}`),
        apiFetch("/api/services"),
      ]);
    } catch {
      setLoadError("Failed to load appointments.");
      return;
    }

    if (!apptsRes.ok) {
      setLoadError("Failed to load appointments.");
      return;
    }

    setLoadError(null);
    setAppointments(await apptsRes.json());
    setServices(servicesRes.ok ? await servicesRes.json() : []);
  }, [apiFetch, showCancelled]);

  useEffect(() => { loadData(); }, [loadData]);

  const serviceName = (id) => services.find((s) => s.id === id)?.name ?? `Service #${id}`;

  async function setStatus(appt, status) {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Bookings</h2>
          <p className="text-sm text-muted-foreground">View and manage appointments</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="show-cancelled" checked={showCancelled} onCheckedChange={setShowCancelled} />
            <Label htmlFor="show-cancelled" className="text-sm text-muted-foreground">Show cancelled</Label>
          </div>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appointments</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments yet.</p>
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
                    <tr key={a.id} className={`border-b last:border-0 ${a.status === "cancelled" ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-4 font-medium">{a.patient_name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{a.client_name}</td>
                      <td className="py-2 pr-4">{serviceName(a.service_id)}</td>
                      <td className="py-2 pr-4">{formatDateTime(a.start_time)}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>{a.status}</Badge>
                      </td>
                      <td className="py-2">
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
        </CardContent>
      </Card>

      <BookingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onBooked={() => loadData()}
      />
    </div>
  );
}
