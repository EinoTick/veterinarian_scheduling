import { useEffect, useState } from "react";
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

export default function CreateRuleModal({ open, onClose, onCreated }) {
  const { apiFetch } = useAuth();
  const [services, setServices] = useState([]);
  const [roles, setRoles] = useState([]);
  const [resources, setResources] = useState([]);

  const [form, setForm] = useState({
    service_id: "",
    required_role_id: "",
    required_resource_id: "",
    is_hard_stop: false,
    description: "",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const safe = (r) => (r.ok ? r.json() : []);
    Promise.all([
      apiFetch("/api/services").then(safe),
      apiFetch("/api/roles").then(safe),
      apiFetch("/api/resources").then(safe),
    ]).then(([s, ro, res]) => {
      setServices(s);
      setRoles(ro);
      setResources(res);
    });
  }, [open, apiFetch]);

  function resetForm() {
    setForm({
      service_id: "",
      required_role_id: "",
      required_resource_id: "",
      is_hard_stop: false,
      description: "",
    });
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const body = {
      service_id: Number(form.service_id),
      is_hard_stop: form.is_hard_stop,
      description: form.description,
    };
    if (form.required_role_id) body.required_role_id = Number(form.required_role_id);
    if (form.required_resource_id) body.required_resource_id = Number(form.required_resource_id);

    const res = await apiFetch("/api/rules", {
      method: "POST",
      body: JSON.stringify(body),
    });

    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json();
      setError(err.detail ?? "Failed to create rule.");
      return;
    }

    resetForm();
    onCreated?.();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Scheduling Rule</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Label>Required Role (optional)</Label>
            <Select
              value={form.required_role_id}
              onValueChange={(v) => setForm((f) => ({ ...f, required_role_id: v }))}
            >
              <SelectTrigger><SelectValue placeholder="No role constraint" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Required Resource (optional)</Label>
            <Select
              value={form.required_resource_id}
              onValueChange={(v) => setForm((f) => ({ ...f, required_resource_id: v }))}
            >
              <SelectTrigger><SelectValue placeholder="No resource constraint" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {resources.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name} ({r.resource_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={submitting || !form.service_id || !form.description}>
              {submitting ? "Saving…" : "Save Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
