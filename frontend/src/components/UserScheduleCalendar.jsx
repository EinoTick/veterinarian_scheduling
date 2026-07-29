import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import { useAuth } from "@/context/AuthContext";
import AppointmentDetailDialog from "@/components/AppointmentDetailDialog";

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

function eventOpacity(status) {
  if (status === "completed" || status === "no_show") return 0.55;
  return 1;
}

export default function UserScheduleCalendar({ userId }) {
  const { apiFetch } = useAuth();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [range, setRange] = useState(null);
  const fetchSeq = useRef(0);
  const abortRef = useRef(null);

  async function fetchSchedule(startStr, endStr) {
    setError(null);
    setRange({ start: startStr, end: endStr });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++fetchSeq.current;

    try {
      const res = await apiFetch(
        `/api/users/${userId}/schedule?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`,
        { signal: controller.signal }
      );
      if (seq !== fetchSeq.current) return;
      if (!res.ok) {
        setError("Failed to load schedule.");
        return;
      }
      const data = await res.json();
      if (seq !== fetchSeq.current) return;
      setEvents(
        data.map((e) => ({
          id: String(e.allocation_id),
          title: `${e.patient_name} — ${e.service_name}`,
          start: e.start_time,
          end: e.end_time,
          backgroundColor: PRESENCE_COLORS[e.presence_type] ?? "#6b7280",
          borderColor: "transparent",
          opacity: eventOpacity(e.status),
          classNames: e.status && e.status !== "scheduled" ? [`status-${e.status}`] : [],
          extendedProps: {
            appointment_id: e.appointment_id,
            presence_type: e.presence_type,
            client_name: e.client_name,
            patient_name: e.patient_name,
            service_name: e.service_name,
            status: e.status,
            start_time: e.start_time,
            end_time: e.end_time,
          },
        }))
      );
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (seq === fetchSeq.current) setError("Network error — is the backend running?");
    }
  }

  function handleEventClick(info) {
    const p = info.event.extendedProps;
    if (!p?.appointment_id) return;
    setSelected({
      appointment_id: p.appointment_id,
      patient_name: p.patient_name,
      client_name: p.client_name,
      service_name: p.service_name,
      presence_type: p.presence_type,
      status: p.status,
      start_time: p.start_time,
      end_time: p.end_time,
    });
  }

  return (
    <div>
      {error && <p className="text-sm text-destructive mb-3">{error}</p>}
      <div className="rounded-md border bg-card p-4">
        <FullCalendar
          key={userId}
          plugins={[timeGridPlugin, dayGridPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "timeGridWeek,timeGridDay",
          }}
          events={events}
          datesSet={(dateInfo) => fetchSchedule(dateInfo.startStr, dateInfo.endStr)}
          eventClick={handleEventClick}
          height="auto"
          firstDay={1}
          slotMinTime="07:00:00"
          slotMaxTime="20:00:00"
          nowIndicator={true}
          allDaySlot={false}
          eventContent={(arg) => (
            <div
              className="px-1 py-0.5 overflow-hidden h-full cursor-pointer"
              style={{ opacity: eventOpacity(arg.event.extendedProps.status) }}
            >
              <div className="font-semibold text-xs leading-tight text-white truncate">
                {arg.event.title}
              </div>
              {arg.event.extendedProps.status && arg.event.extendedProps.status !== "scheduled" && (
                <div className="text-[10px] uppercase tracking-wide text-white/90 truncate">
                  {arg.event.extendedProps.status.replaceAll("_", " ")}
                </div>
              )}
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

      <AppointmentDetailDialog
        open={!!selected}
        appointmentId={selected?.appointment_id}
        seed={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          if (range) fetchSchedule(range.start, range.end);
        }}
      />
    </div>
  );
}
