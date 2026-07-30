import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { can } from "@/lib/rbac";
import {
  CalendarDays,
  CalendarRange,
  DoorOpen,
  Users,
  ShieldCheck,
  UserCircle,
  KeyRound,
  LogOut,
  Stethoscope,
  PawPrint,
  Boxes,
  Menu,
  X,
  Building2,
  ScrollText,
  BriefcaseMedical,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/bookings", label: "Bookings", icon: CalendarDays, capability: "book" },
  { to: "/schedule", label: "My Schedule", icon: CalendarRange, capability: "viewSchedules" },
  { to: "/resource-schedule", label: "Schedules", icon: DoorOpen, capability: "viewSchedules" },
  { to: "/clients", label: "Clients", icon: PawPrint, capability: "manageClients" },
  { to: "/resources", label: "Resources", icon: Boxes, capability: "manageCatalog" },
  { to: "/services", label: "Services", icon: Stethoscope, capability: "manageCatalog" },
  { to: "/users", label: "Users", icon: Users, capability: "manageCatalog" },
  { to: "/roles", label: "Roles", icon: BriefcaseMedical, capability: "manageClinicalRoles" },
  { to: "/rules", label: "Rules", icon: ShieldCheck, capability: "manageCatalog" },
  { to: "/overrides", label: "Overrides", icon: ScrollText, capability: "viewOverrideAudit" },
  { to: "/clinics", label: "Clinic", icon: Building2, capability: "manageClinicSettings" },
  { to: "/profile", label: "My Profile", icon: UserCircle },
  { to: "/change-password", label: "Change Password", icon: KeyRound },
];

function NavItem({ to, label, icon: Icon, onNavigate }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
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

function SidebarNav({ items, onNavigate, onLogout, user }) {
  return (
    <>
      <div className="border-b px-4 py-4">
        <h1 className="text-base font-semibold tracking-tight">VetClinic Scheduler</h1>
        {user && (
          <p className="mt-1 truncate text-xs text-muted-foreground">{user.name}</p>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3 overflow-y-auto">
        {items.map((item) => (
          <NavItem key={item.to} {...item} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const drawer = drawerRef.current;
    const focusables = drawer
      ? drawer.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      : [];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus?.();

    const onKey = (e) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (e.key !== "Tab" || focusables.length === 0) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      menuButtonRef.current?.focus?.();
    };
  }, [mobileOpen]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const role = user?.system_role;
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.capability) return true;
    return can(role, item.capability);
  });

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-card">
        <SidebarNav
          items={visibleItems}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            ref={drawerRef}
            id="mobile-nav-drawer"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col border-r bg-card shadow-lg"
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">Menu</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <SidebarNav
              items={visibleItems}
              user={user}
              onNavigate={() => setMobileOpen(false)}
              onLogout={handleLogout}
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur md:hidden">
          <Button
            ref={menuButtonRef}
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">VetClinic Scheduler</p>
            {user?.name && (
              <p className="truncate text-xs text-muted-foreground">{user.name}</p>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
            <CatalogErrorBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function CatalogErrorBanner() {
  const { lastError, dismissErrors, invalidate, ensure } = useCatalog();
  const [retrying, setRetrying] = useState(false);
  if (!lastError) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      <span>{lastError}</span>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              invalidate();
              await ensure();
            } catch {
              /* errors map refreshed by CatalogContext */
            } finally {
              setRetrying(false);
            }
          }}
        >
          {retrying ? "Retrying…" : "Retry"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={dismissErrors}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
