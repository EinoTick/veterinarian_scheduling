import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppointmentDetailDialog from "@/components/AppointmentDetailDialog";
import { readErrorMessage } from "@/lib/http";
import {
  clinicDayEndExclusiveIso,
  clinicDayStartIso,
  formatInClinic,
} from "@/lib/datetime";
import { useClinicTimezone } from "@/hooks/useClinicTimezone";

const PAGE_SIZE = 50;

export default function OverridesPage() {
  const { apiFetch } = useAuth();
  const clinicTz = useClinicTimezone();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [overrideType, setOverrideType] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    if (fromDate && toDate && fromDate > toDate) {
      setLoadError("Start date must be on or before end date.");
      return;
    }
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (overrideType !== "all") qs.set("override_type", overrideType);
    if (fromDate) qs.set("start", clinicDayStartIso(fromDate, clinicTz));
    if (toDate) qs.set("end", clinicDayEndExclusiveIso(toDate, clinicTz));

    try {
      const res = await apiFetch(`/api/override-logs?${qs}`);
      if (!res.ok) {
        setLoadError(await readErrorMessage(res, "Failed to load override log."));
        return;
      }
      const body = await res.json();
      setLoadError(null);
      setItems(body.items ?? []);
      setTotal(body.total ?? 0);
    } catch {
      setLoadError("Failed to load override log.");
    }
  }, [apiFetch, offset, overrideType, fromDate, toDate, clinicTz]);

  useEffect(() => { load(); }, [load]);

  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  function openDetail(id) {
    setDetailId(id);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Override audit</h2>
        <p className="text-sm text-muted-foreground">
          Soft-stop and double-booking overrides (times in {clinicTz})
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Type</Label>
          <Select
            value={overrideType}
            onValueChange={(v) => { setOffset(0); setOverrideType(v); }}
          >
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="soft_stop">Soft stop</SelectItem>
              <SelectItem value="double_booking">Double-booking</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ov-from">From</Label>
          <Input
            id="ov-from"
            type="date"
            value={fromDate}
            onChange={(e) => { setOffset(0); setFromDate(e.target.value); }}
            className="w-auto"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ov-to">To</Label>
          <Input
            id="ov-to"
            type="date"
            value={toDate}
            onChange={(e) => { setOffset(0); setToDate(e.target.value); }}
            className="w-auto"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Log
            {total > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overrides in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">When</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Patient</th>
                    <th className="pb-2 pr-4">Authorizer</th>
                    <th className="pb-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open appointment for ${row.patient_name || "patient"}`}
                      onClick={() => openDetail(row.appointment_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDetail(row.appointment_id);
                        }
                      }}
                    >
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatInClinic(row.timestamp, clinicTz)}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={row.override_type === "double_booking" ? "destructive" : "secondary"}>
                          {row.override_type?.replaceAll("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="font-medium">{row.patient_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{row.client_name}</div>
                      </td>
                      <td className="py-2 pr-4">{row.authorizer_name || `#${row.overridden_by_user_id}`}</td>
                      <td className="py-2 text-muted-foreground max-w-xs truncate">
                        {row.rule_description || row.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(canPrev || canNext) && (
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={!canPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={!canNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AppointmentDetailDialog
        appointmentId={detailId}
        open={detailId != null}
        onClose={() => setDetailId(null)}
        onChanged={() => load()}
      />
    </div>
  );
}
