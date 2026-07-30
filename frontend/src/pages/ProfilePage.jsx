import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_BADGE_VARIANT as ROLE_BADGE } from "@/lib/constants";

export default function ProfilePage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">My Profile</h2>
        <p className="text-sm text-muted-foreground">Your account information</p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</p>
            <p className="mt-1 text-sm font-medium">{user.name}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
            <p className="mt-1 text-sm">{user.email}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clinical Role</p>
            <p className="mt-1 text-sm">{user.role?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">System Role</p>
            <div className="mt-1">
              <Badge variant={ROLE_BADGE[user.system_role] ?? "secondary"}>
                {user.system_role}
              </Badge>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
            <p className="mt-1 text-sm">{user.is_active ? "Active" : "Inactive"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
