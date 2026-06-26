import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

/**
 * Wraps a route tree. Redirects to /login if unauthenticated.
 * Optionally restricts to one or more system_role values.
 *
 * Usage:
 *   <Route element={<ProtectedRoute />}>           ← any authenticated user
 *   <Route element={<ProtectedRoute roles={["CLINIC_ADMIN","SYSTEM_ADMIN"]} />}>
 */
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.system_role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
