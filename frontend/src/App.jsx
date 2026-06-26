import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import BookingModal from "@/components/BookingModal";
import RuleBuilder from "@/components/RuleBuilder";

export default function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [lastBooked, setLastBooked] = useState(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">VetClinic Scheduler</h1>
        <Button onClick={() => setModalOpen(true)}>+ New Appointment</Button>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto">
        {lastBooked && (
          <div className="mb-4 rounded-md border border-green-400 bg-green-50 px-4 py-2 text-sm text-green-800">
            Appointment booked for <strong>{lastBooked.patient_name}</strong> (
            {lastBooked.client_name}) — ID #{lastBooked.id}
          </div>
        )}

        <Tabs defaultValue="rules">
          <TabsList>
            <TabsTrigger value="rules">Rules Engine</TabsTrigger>
          </TabsList>
          <TabsContent value="rules" className="mt-4">
            <RuleBuilder />
          </TabsContent>
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
