import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import AppointmentDetailDialog from "@/components/AppointmentDetailDialog";

const TYPE_COLORS = {
  room: "#6366f1",
  equipment: "#0891b2",
};

export default function ResourceSchedule() {
  const { apiFetch } = useAuth();
  const { resources, ensure } = useCatalog();
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const dateRangeRef = useRef(null);
  const fetchSeq = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => {
    ensure(["resources"]).catch(() => {});
  }, [ensure]);

  async function fetchSchedule(resourceId, startStr, endStr) {
    if (!resourceId) return;
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++fetchSeq.current;

    try {
      const res = await apiFetch(
        `/api/resources/${resourceId}/schedule?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`,
        { signal: controller.signal }
      );
      if (seq !== fetchSeq.current) return;
      if (!res.ok) {
        setError("Failed to load schedule.");
        return;
      }
      const data = await res.json();
      if (seq !== fetchSeq.current) return;
      const selected = resources.find((r) => String(r.id) === String(resourceId));
      const color = TYPE_COLORS[selected?.resource_type] ?? "#6b7280";
      setEvents(
        data.map((e) => ({
          id: String(e.allocation_id),
          title: `${e.patient_name} — ${e.service_name}`,
          start: e.start_time,
          end: e.end_time,
          backgroundColor: color,
          borderColor: "transparent",
          extendedProps: {
            appointment_id: e.appointment_id,
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

  function handleDatesSet(dateInfo) {
    dateRangeRef.current = { start: dateInfo.startStr, end: dateInfo.endStr };
    fetchSchedule(selectedId, dateInfo.startStr, dateInfo.endStr);
  }

  function handleResourceChange(id) {
    setSelectedId(id);
    setEvents([]);
    if (dateRangeRef.current) {
      fetchSchedule(id, dateRangeRef.current.start, dateRangeRef.current.end);
    }
  }

  function handleEventClick(info) {
    const p = info.event.extendedProps;
    if (!p?.appointment_id) return;
    setSelectedEvent({
      appointment_id: p.appointment_id,
      patient_name: p.patient_name,
      client_name: p.client_name,
      service_name: p.service_name,
      status: p.status,
      start_time: p.start_time,
      end_time: p.end_time,
    });
  }

  const selectedResource = resources.find((r) => String(r.id) === selectedId);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Rooms & Equipment</h1>
      <p className="text-sm text-muted-foreground mb-4">
        View booking blocks for a specific room or piece of equipment. Click an event for details.
      </p>

      <div className="mb-5 max-w-xs">
        <Label className="mb-1.5 block">Select Resource</Label>
        <Select value={selectedId} onValueChange={handleResourceChange}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a room or equipment…" />
          </SelectTrigger>
          <SelectContent>
            {resources.length === 0 && (
              <SelectItem value="__none" disabled>No resources found</SelectItem>
            )}
            {resources.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>
                {r.name}
                <span className="ml-1.5 text-muted-foreground capitalize">({r.resource_type})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {!selectedId ? (
        <div className="rounded-md border border-dashed p-16 text-center text-muted-foreground text-sm">
          Select a resource above to view its schedule.
        </div>
      ) : (
        <>
          {selectedResource && (
            <div className="mb-3 flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-sm shrink-0"
                style={{ backgroundColor: TYPE_COLORS[selectedResource.resource_type] ?? "#6b7280" }}
              />
              <span className="text-sm font-medium">{selectedResource.name}</span>
              <span className="text-xs text-muted-foreground capitalize">
                ({selectedResource.resource_type})
              </span>
            </div>
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
              datesSet={handleDatesSet}
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
                  style={{
                    opacity:
                      arg.event.extendedProps.status === "completed"
                      || arg.event.extendedProps.status === "no_show"
                        ? 0.55
                        : 1,
                  }}
                >
                  <div className="font-semibold text-xs leading-tight text-white truncate">
                    {arg.event.title}
                  </div>
                  {arg.event.extendedProps.status && arg.event.extendedProps.status !== "scheduled" && (
                    <div className="text-[10px] uppercase tracking-wide text-white/90 truncate">
                      {arg.event.extendedProps.status.replaceAll("_", " ")}
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
        </>
      )}

      <AppointmentDetailDialog
        open={!!selectedEvent}
        appointmentId={selectedEvent?.appointment_id}
        seed={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onChanged={() => {
          if (dateRangeRef.current && selectedId) {
            fetchSchedule(selectedId, dateRangeRef.current.start, dateRangeRef.current.end);
          }
        }}
      />
    </div>
  );
}
