import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CreateRuleModal from "@/components/CreateRuleModal";
import { Pencil, Plus, Power } from "lucide-react";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function RulesPage() {
  const { apiFetch } = useAuth();
  const { services, roles, resources, ensure, invalidate } = useCatalog();
  const [rules, setRules] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const loadData = useCallback(async () => {
    try {
      await ensure(["services", "roles", "resources"]);
      const rulesRes = await apiFetch(`/api/rules?include_inactive=${includeInactive}`);
      if (!rulesRes.ok) {
        setLoadError("Failed to load rules.");
        return;
      }
      setLoadError(null);
      setRules(await rulesRes.json());
    } catch {
      setLoadError("Failed to load rules.");
    }
  }, [apiFetch, ensure, includeInactive]);

  useEffect(() => { loadData(); }, [loadData]);

  async function deactivateRule(rule) {
    if (!window.confirm(`Deactivate this rule?\n\n"${rule.description}"`)) return;
    const res = await apiFetch(`/api/rules/${rule.id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      invalidate(["rules"]);
      loadData();
    }
  }

  async function reactivateRule(rule) {
    const res = await apiFetch(`/api/rules/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: true }),
    });
    if (res.ok) {
      invalidate(["rules"]);
      loadData();
    }
  }

  const serviceName = (id) => services.find((s) => s.id === id)?.name ?? id;
  const roleName = (id) => roles.find((r) => r.id === id)?.name ?? "—";
  const resourceName = (id) => resources.find((r) => r.id === id)?.name ?? "—";

  function constraintSummary(r) {
    const parts = [];
    if (r.required_role_id) parts.push(roleName(r.required_role_id));
    if (r.alternative_role_ids?.length) {
      parts.push(`or ${r.alternative_role_ids.map(roleName).join("/")}`);
    }
    if (r.min_quantity > 1) parts.push(`×${r.min_quantity}`);
    if (r.required_resource_id) parts.push(resourceName(r.required_resource_id));
    if (r.required_resource_category) parts.push(`cat:${r.required_resource_category}`);
    if (r.required_resource_type) parts.push(`type:${r.required_resource_type}`);
    return parts.length ? parts.join(" · ") : "—";
  }

  function scopeSummary(r) {
    const bits = [];
    if (r.active_weekdays?.length) {
      bits.push(r.active_weekdays.map((d) => WEEKDAY_LABELS[d]).join(","));
    }
    if (r.active_start_time || r.active_end_time) {
      bits.push(`${r.active_start_time || "…"}–${r.active_end_time || "…"}`);
    }
    if (r.duration_minutes != null || (r.start_offset_minutes && r.start_offset_minutes > 0)) {
      bits.push(`@${r.start_offset_minutes || 0}+${r.duration_minutes ?? "full"}m`);
    }
    if (r.presence_type) bits.push(r.presence_type);
    return bits.length ? bits.join(" · ") : "Always";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Rules</h2>
          <p className="text-sm text-muted-foreground">Scheduling constraints and validations</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="include-inactive"
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
            />
            <Label htmlFor="include-inactive" className="text-sm text-muted-foreground">
              Show inactive
            </Label>
          </div>
          <Button onClick={() => { setEditingRule(null); setModalOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            New Rule
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules defined yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Service</th>
                    <th className="pb-2 pr-4">Constraint</th>
                    <th className="pb-2 pr-4">Scope</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Description</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className={`border-b last:border-0 ${!r.is_active ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-4 font-medium">{serviceName(r.service_id)}</td>
                      <td className="py-2 pr-4">{constraintSummary(r)}</td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{scopeSummary(r)}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-col gap-1">
                          <Badge variant={r.is_hard_stop ? "destructive" : "secondary"}>
                            {r.is_hard_stop ? "Hard Stop" : "Soft Stop"}
                          </Badge>
                          {!r.is_active && (
                            <Badge variant="outline">Inactive</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.description}</td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Edit"
                            aria-label="Edit rule"
                            onClick={() => { setEditingRule(r); setModalOpen(true); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={r.is_active ? "Deactivate" : "Reactivate"}
                            aria-label={r.is_active ? "Deactivate rule" : "Reactivate rule"}
                            onClick={() => (r.is_active ? deactivateRule(r) : reactivateRule(r))}
                          >
                            <Power className={`h-3.5 w-3.5 ${r.is_active ? "" : "text-green-600"}`} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateRuleModal
        open={modalOpen}
        rule={editingRule}
        onClose={() => { setModalOpen(false); setEditingRule(null); }}
        onSaved={loadData}
      />
    </div>
  );
}
