import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { CatalogProvider } from "@/context/CatalogContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import UnauthorizedPage from "@/pages/UnauthorizedPage";

const BookingsPage = lazy(() => import("@/pages/BookingsPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const RulesPage = lazy(() => import("@/pages/RulesPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));
const MySchedule = lazy(() => import("@/pages/MySchedule"));
const ResourceSchedule = lazy(() => import("@/pages/ResourceSchedule"));
const ResourcesPage = lazy(() => import("@/pages/ResourcesPage"));
const ServicesPage = lazy(() => import("@/pages/ServicesPage"));
const ClientsPage = lazy(() => import("@/pages/ClientsPage"));
const ClinicsPage = lazy(() => import("@/pages/ClinicsPage"));
const OverridesPage = lazy(() => import("@/pages/OverridesPage"));
const RolesPage = lazy(() => import("@/pages/RolesPage"));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground" role="status">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <CatalogProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/bookings" replace />} />
                    <Route path="bookings" element={<BookingsPage />} />
                    <Route path="schedule" element={<MySchedule />} />
                    <Route path="resource-schedule" element={<ResourceSchedule />} />
                    <Route path="clients" element={<ClientsPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="change-password" element={<ChangePasswordPage />} />
                    <Route element={<ProtectedRoute roles={["CLINIC_ADMIN", "SYSTEM_ADMIN"]} />}>
                      <Route path="users" element={<UsersPage />} />
                      <Route path="roles" element={<RolesPage />} />
                      <Route path="rules" element={<RulesPage />} />
                      <Route path="resources" element={<ResourcesPage />} />
                      <Route path="services" element={<ServicesPage />} />
                      <Route path="overrides" element={<OverridesPage />} />
                      <Route path="clinics" element={<ClinicsPage />} />
                    </Route>
                  </Route>
                </Route>

                <Route path="/unauthorized" element={<UnauthorizedPage />} />
                <Route path="*" element={<Navigate to="/bookings" replace />} />
              </Routes>
            </Suspense>
          </CatalogProvider>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
