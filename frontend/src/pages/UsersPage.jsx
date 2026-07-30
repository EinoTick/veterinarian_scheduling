import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CreateUserModal from "@/components/CreateUserModal";
import UserScheduleDialog from "@/components/UserScheduleDialog";
import { Plus } from "lucide-react";
import { ROLE_BADGE_VARIANT as ROLE_BADGE, LIST_FETCH_LIMIT } from "@/lib/constants";
import { unwrapList, readErrorMessage, listCountLabel } from "@/lib/http";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

export default function UsersPage() {
  const { apiFetch, user: currentUser } = useAuth();
  const { invalidate } = useCatalog();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [scheduleUser, setScheduleUser] = useState(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const loadUsers = useCallback(async () => {
    let res;
    try {
      res = await apiFetch(
        `/api/users?include_inactive=${includeInactive}&limit=${LIST_FETCH_LIMIT}`
      );
    } catch {
      setLoadError("Failed to load users.");
      return;
    }
    if (!res.ok) {
      setLoadError(await readErrorMessage(res, "Failed to load users."));
      return;
    }
    setLoadError(null);
    const body = await res.json();
    const { items, total } = unwrapList(body);
    setUsers(items);
    setListTotal(total);
  }, [apiFetch, includeInactive]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function toggleActive(u, e) {
    e.stopPropagation();
    if (u.id === currentUser?.id && u.is_active) {
      setLoadError("You cannot deactivate your own account.");
      return;
    }
    if (u.is_active) {
      if (!(await confirm({
        title: "Deactivate user?",
        description: `Deactivate ${u.name}? They will no longer be able to sign in.`,
        destructive: true,
        confirmLabel: "Deactivate",
      }))) return;
    }
    const res = await apiFetch(`/api/users/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !u.is_active }),
    });
    if (!res.ok) {
      setLoadError(await readErrorMessage(res, "Failed to update user."));
      return;
    }
    setLoadError(null);
    invalidate(["staff"]);
    loadUsers();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage clinic staff. Click a row to view their schedule.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="users-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
            <Label htmlFor="users-inactive" className="text-sm text-muted-foreground">Show inactive</Label>
          </div>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Staff
            {currentUser?.system_role === "SYSTEM_ADMIN" && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">(all clinics)</span>
            )}
          </CardTitle>
          {!loadError && users.length > 0 && (
            <p className="text-sm font-normal text-muted-foreground">
              {listCountLabel(users.length, listTotal)}
              {listTotal > users.length ? " — refine filters or raise the page limit." : ""}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Email</th>
                    <th className="pb-2 pr-4">Clinical Role</th>
                    <th className="pb-2 pr-4">System Role</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => setScheduleUser(u)}
                      tabIndex={0}
                      role="button"
                      aria-label={`View ${u.name}'s schedule`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setScheduleUser(u);
                        }
                      }}
                      className={`border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${!u.is_active ? "opacity-50" : ""}`}
                    >
                      <td className="py-2 pr-4 font-medium">
                        {u.name}
                        {!u.is_active && (
                          <Badge variant="outline" className="ml-2">Inactive</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.email}</td>
                      <td className="py-2 pr-4">{u.role?.name ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={ROLE_BADGE[u.system_role] ?? "secondary"}>
                          {u.system_role}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={u.id === currentUser?.id && u.is_active}
                          title={u.id === currentUser?.id && u.is_active ? "You cannot deactivate yourself" : undefined}
                          onClick={(e) => toggleActive(u, e)}
                        >
                          {u.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={loadUsers}
      />

      <UserScheduleDialog
        user={scheduleUser}
        open={!!scheduleUser}
        onClose={() => setScheduleUser(null)}
      />

      <ConfirmDialog />
    </div>
  );
}
