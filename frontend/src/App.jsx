import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import LoginPage from "@/pages/LoginPage";
import UserManagement from "@/pages/UserManagement";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import BookingModal from "@/components/BookingModal";
import RuleBuilder from "@/components/RuleBuilder";
import { useState } from "react";

function AppShell() {
  const { user, logout } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [lastBooked, setLastBooked] = useState(null);

  const isAdmin = user?.system_role === "CLINIC_ADMIN" || user?.system_role === "SYSTEM_ADMIN";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">VetClinic Scheduler</h1>
          {user && (
            <p className="text-xs text-muted-foreground">
              {user.name} · {user.system_role}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setModalOpen(true)}>+ New Appointment</Button>
          <Button variant="outline" onClick={logout}>Sign Out</Button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto">
        {lastBooked && (
          <div className="mb-4 rounded-md border border-green-400 bg-green-50 px-4 py-2 text-sm text-green-800">
            Appointment booked for <strong>{lastBooked.patient_name}</strong> ({lastBooked.client_name}) — ID #{lastBooked.id}
          </div>
        )}

        <Tabs defaultValue={isAdmin ? "users" : "rules"}>
          <TabsList>
            {isAdmin && <TabsTrigger value="users">Staff</TabsTrigger>}
            {isAdmin && <TabsTrigger value="rules">Rules Engine</TabsTrigger>}
          </TabsList>
          {isAdmin && (
            <TabsContent value="users" className="mt-4">
              <UserManagement />
            </TabsContent>
          )}
          {isAdmin && (
            <TabsContent value="rules" className="mt-4">
              <RuleBuilder />
            </TabsContent>
          )}
        </Tabs>
      </main>

      <BookingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onBooked={(appt) => setLastBooked(appt)}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* All authenticated users */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<AppShell />} />
          </Route>

          {/* Admin-only example */}
          <Route element={<ProtectedRoute roles={["CLINIC_ADMIN", "SYSTEM_ADMIN"]} />}>
            <Route path="/admin/users" element={<UserManagement />} />
          </Route>

          <Route path="/unauthorized" element={
            <div className="flex h-screen items-center justify-center text-muted-foreground">
              Access denied.
            </div>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
