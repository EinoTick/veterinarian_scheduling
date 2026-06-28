import { useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import { useAuth } from "@/context/AuthContext";

const PRESENCE_COLORS = {
  IN_ROOM: "#3b82f6",
  IN_BUILDING: "#8b5cf6",
  REMOTE: "#10b981",
};

const PRESENCE_LABELS = {
  IN_ROOM: "In Room",
  IN_BUILDING: "In Building",
  REMOTE: "Remote",
};

export default function MySchedule() {
  const { user, apiFetch } = useAuth();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  async function fetchSchedule(startStr, endStr) {
    setError(null);
    try {
      const res = await apiFetch(
        `/api/users/${user.id}/schedule?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`
      );
      if (!res.ok) {
        setError("Failed to load schedule.");
        return;
      }
      const data = await res.json();
      setEvents(
        data.map((e) => ({
          id: String(e.allocation_id),
          title: `${e.patient_name} — ${e.service_name}`,
          start: e.start_time,
          end: e.end_time,
          backgroundColor: PRESENCE_COLORS[e.presence_type] ?? "#6b7280",
          borderColor: "transparent",
          extendedProps: {
            presence_type: e.presence_type,
            client_name: e.client_name,
          },
        }))
      );
    } catch {
      setError("Network error — is the backend running?");
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">My Schedule</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Shows only your allocated time blocks, not the full appointment duration.
      </p>

      {error && (
        <p className="text-sm text-destructive mb-4">{error}</p>
      )}

      <div className="rounded-md border bg-card p-4">
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "timeGridWeek,timeGridDay",
          }}
          events={events}
          datesSet={(dateInfo) => fetchSchedule(dateInfo.startStr, dateInfo.endStr)}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="20:00:00"
          nowIndicator={true}
          allDaySlot={false}
          eventContent={(arg) => (
            <div className="px-1 py-0.5 overflow-hidden h-full">
              <div className="font-semibold text-xs leading-tight text-white truncate">
                {arg.event.title}
              </div>
              {arg.event.extendedProps.presence_type && (
                <div className="text-xs text-white/80 truncate">
                  {PRESENCE_LABELS[arg.event.extendedProps.presence_type] ?? arg.event.extendedProps.presence_type}
                </div>
              )}
              {arg.event.extendedProps.client_name && (
                <div className="text-xs text-white/70 truncate">
                  {arg.event.extendedProps.client_name}
                </div>
              )}
            </div>
          )}
        />
      </div>

      <div className="flex gap-4 mt-3">
        {Object.entries(PRESENCE_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div
              className="h-2.5 w-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: PRESENCE_COLORS[key] }}
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
