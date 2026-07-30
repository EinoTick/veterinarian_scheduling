import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="space-y-2 max-w-md">
        <p className="text-sm font-medium text-muted-foreground">VetClinic Scheduler</p>
        <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>
        <p className="text-sm text-muted-foreground">
          You do not have permission to view this page.
          {user?.name ? ` Signed in as ${user.name}.` : ""}
          {" "}
          If you think this is a mistake, ask a clinic administrator to update your role.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          Go back
        </Button>
        <Button asChild>
          <Link to="/bookings">Go to bookings</Link>
        </Button>
        {!user && (
          <Button asChild variant="outline">
            <Link to="/login">Sign in</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
