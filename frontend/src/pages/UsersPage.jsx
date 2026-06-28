import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CreateUserModal from "@/components/CreateUserModal";
import UserScheduleDialog from "@/components/UserScheduleDialog";
import { Plus } from "lucide-react";

const ROLE_BADGE = {
  SYSTEM_ADMIN: "destructive",
  CLINIC_ADMIN: "default",
  USER: "secondary",
};

export default function UsersPage() {
  const { apiFetch, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [scheduleUser, setScheduleUser] = useState(null);

  const loadUsers = useCallback(async () => {
    let res;
    try {
      res = await apiFetch("/api/users");
    } catch {
      setLoadError("Failed to load users.");
      return;
    }
    if (!res.ok) {
      setLoadError("Failed to load users.");
      return;
    }
    setLoadError(null);
    setUsers(await res.json());
  }, [apiFetch]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage clinic staff. Click a row to view their schedule.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Staff
            {currentUser?.system_role === "SYSTEM_ADMIN" && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">(all clinics)</span>
            )}
          </CardTitle>
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
                    <th className="pb-2">System Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => setScheduleUser(u)}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-2 pr-4 font-medium">{u.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.email}</td>
                      <td className="py-2 pr-4">{u.role?.name ?? "—"}</td>
                      <td className="py-2">
                        <Badge variant={ROLE_BADGE[u.system_role] ?? "secondary"}>
                          {u.system_role}
                        </Badge>
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
    </div>
  );
}
