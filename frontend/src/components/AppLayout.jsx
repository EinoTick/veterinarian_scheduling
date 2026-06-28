import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CalendarRange,
  Users,
  ShieldCheck,
  UserCircle,
  KeyRound,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/bookings", label: "Bookings", icon: CalendarDays },
  { to: "/schedule", label: "My Schedule", icon: CalendarRange },
  { to: "/users", label: "Users", icon: Users, adminOnly: true },
  { to: "/rules", label: "Rules", icon: ShieldCheck, adminOnly: true },
  { to: "/profile", label: "My Profile", icon: UserCircle },
  { to: "/change-password", label: "Change Password", icon: KeyRound },
];

function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const isAdmin =
    user?.system_role === "CLINIC_ADMIN" || user?.system_role === "SYSTEM_ADMIN";

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="border-b px-4 py-4">
          <h1 className="text-base font-semibold tracking-tight">VetClinic Scheduler</h1>
          {user && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{user.name}</p>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {visibleItems.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        <div className="border-t p-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
