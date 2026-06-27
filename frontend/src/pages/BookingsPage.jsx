import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BookingModal from "@/components/BookingModal";
import { Plus } from "lucide-react";

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function BookingsPage() {
  const { apiFetch } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [services, setServices] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    const safe = (r) => (r.ok ? r.json() : []);
    const [apptsRes, servicesRes] = await Promise.all([
      apiFetch("/api/appointments"),
      apiFetch("/api/services"),
    ]);

    if (!apptsRes.ok) {
      setLoadError("Failed to load appointments.");
      return;
    }

    setLoadError(null);
    setAppointments(await apptsRes.json());
    setServices(await servicesRes.then(safe));
  }, [apiFetch]);

  useEffect(() => { loadData(); }, [loadData]);

  const serviceName = (id) => services.find((s) => s.id === id)?.name ?? `Service #${id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Bookings</h2>
          <p className="text-sm text-muted-foreground">View and manage appointments</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Booking
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Appointments</CardTitle>
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
                    <th className="pb-2 pr-4">End</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{a.patient_name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{a.client_name}</td>
                      <td className="py-2 pr-4">{serviceName(a.service_id)}</td>
                      <td className="py-2 pr-4">{formatDateTime(a.start_time)}</td>
                      <td className="py-2 pr-4">{formatDateTime(a.end_time)}</td>
                      <td className="py-2">
                        <Badge variant="secondary">{a.status}</Badge>
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
