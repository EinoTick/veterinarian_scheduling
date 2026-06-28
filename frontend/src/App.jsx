import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import BookingsPage from "@/pages/BookingsPage";
import UsersPage from "@/pages/UsersPage";
import RulesPage from "@/pages/RulesPage";
import ProfilePage from "@/pages/ProfilePage";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import MySchedule from "@/pages/MySchedule";
import ResourceSchedule from "@/pages/ResourceSchedule";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/bookings" replace />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="schedule" element={<MySchedule />} />
              <Route path="resource-schedule" element={<ResourceSchedule />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="change-password" element={<ChangePasswordPage />} />
              <Route element={<ProtectedRoute roles={["CLINIC_ADMIN", "SYSTEM_ADMIN"]} />}>
                <Route path="users" element={<UsersPage />} />
                <Route path="rules" element={<RulesPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="/unauthorized" element={
            <div className="flex h-screen items-center justify-center text-muted-foreground">
              Access denied.
            </div>
          } />
          <Route path="*" element={<Navigate to="/bookings" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
