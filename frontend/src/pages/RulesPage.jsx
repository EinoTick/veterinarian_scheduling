import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CreateRuleModal from "@/components/CreateRuleModal";
import { Plus } from "lucide-react";

export default function RulesPage() {
  const { apiFetch } = useAuth();
  const [services, setServices] = useState([]);
  const [roles, setRoles] = useState([]);
  const [resources, setResources] = useState([]);
  const [rules, setRules] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    const safe = (r) => (r.ok ? r.json() : []);
    const [rulesRes, servicesRes, rolesRes, resourcesRes] = await Promise.all([
      apiFetch("/api/rules"),
      apiFetch("/api/services"),
      apiFetch("/api/roles"),
      apiFetch("/api/resources"),
    ]);

    if (!rulesRes.ok) {
      setLoadError("Failed to load rules.");
      return;
    }

    setLoadError(null);
    setRules(await rulesRes.json());
    setServices(await servicesRes.then(safe));
    setRoles(await rolesRes.then(safe));
    setResources(await resourcesRes.then(safe));
  }, [apiFetch]);

  useEffect(() => { loadData(); }, [loadData]);

  const serviceName = (id) => services.find((s) => s.id === id)?.name ?? id;
  const roleName = (id) => roles.find((r) => r.id === id)?.name ?? "—";
  const resourceName = (id) => resources.find((r) => r.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Rules</h2>
          <p className="text-sm text-muted-foreground">Scheduling constraints and validations</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Rule
        </Button>
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
                    <th className="pb-2 pr-4">Required Role</th>
                    <th className="pb-2 pr-4">Required Resource</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{serviceName(r.service_id)}</td>
                      <td className="py-2 pr-4">{r.required_role_id ? roleName(r.required_role_id) : "—"}</td>
                      <td className="py-2 pr-4">
                        {r.required_resource_id ? resourceName(r.required_resource_id) : "—"}
                      </td>
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

      <CreateRuleModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={loadData}
      />
    </div>
  );
}
