import { useEffect, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";

export default function RuleBuilder({ onRuleCreated }) {
  const { apiFetch } = useAuth();
  const [services, setServices] = useState([]);
  const [roles, setRoles] = useState([]);
  const [resources, setResources] = useState([]);
  const [existingRules, setExistingRules] = useState([]);

  const [form, setForm] = useState({
    service_id: "",
    required_role_id: "",
    required_resource_id: "",
    is_hard_stop: false,
    description: "",
  });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  function loadData() {
    const safe = (r) => r.ok ? r.json() : [];
    Promise.all([
      apiFetch("/api/services").then(safe),
      apiFetch("/api/roles").then(safe),
      apiFetch("/api/resources").then(safe),
      apiFetch("/api/rules").then(safe),
    ]).then(([s, ro, res, rules]) => {
      setServices(s);
      setRoles(ro);
      setResources(res);
      setExistingRules(rules);
    });
  }

  useEffect(() => { loadData(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

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

    if (!res.ok) {
      const err = await res.json();
      setError(err.detail ?? "Failed to create rule.");
      return;
    }

    setSuccess(true);
    setForm({ service_id: "", required_role_id: "", required_resource_id: "", is_hard_stop: false, description: "" });
    loadData();
    onRuleCreated?.();
  }

  const serviceName = (id) => services.find((s) => s.id === id)?.name ?? id;
  const roleName = (id) => roles.find((r) => r.id === id)?.name ?? "—";
  const resourceName = (id) => resources.find((r) => r.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Scheduling Rule</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>Service</Label>
              <Select value={form.service_id} onValueChange={(v) => setForm((f) => ({ ...f, service_id: v }))} required>
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
              <Select value={form.required_role_id} onValueChange={(v) => setForm((f) => ({ ...f, required_role_id: v }))}>
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
              <Select value={form.required_resource_id} onValueChange={(v) => setForm((f) => ({ ...f, required_resource_id: v }))}>
                <SelectTrigger><SelectValue placeholder="No resource constraint" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {resources.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.name} ({r.resource_type})</SelectItem>
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
                <span className="text-muted-foreground text-xs">
                  (blocks booking entirely; otherwise shows override warning)
                </span>
              </Label>
            </div>

            {error && (
              <p className="text-sm text-destructive">
                {typeof error === "string" ? error : JSON.stringify(error)}
              </p>
            )}
            {success && <p className="text-sm text-green-600">Rule created successfully.</p>}

            <Button type="submit" className="w-full">Save Rule</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Existing Rules</CardTitle></CardHeader>
        <CardContent>
          {existingRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules defined yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Service</th>
                    <th className="pb-2 pr-4">Required Role</th>
                    <th className="pb-2 pr-4">Required Resource</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {existingRules.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{serviceName(r.service_id)}</td>
                      <td className="py-2 pr-4">{r.required_role_id ? roleName(r.required_role_id) : "—"}</td>
                      <td className="py-2 pr-4">{r.required_resource_id ? resourceName(r.required_resource_id) : "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.is_hard_stop ? "destructive" : "secondary"}>
                          {r.is_hard_stop ? "Hard Stop" : "Soft Stop"}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground">{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
