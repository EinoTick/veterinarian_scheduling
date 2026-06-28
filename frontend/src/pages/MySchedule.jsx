import { useAuth } from "@/context/AuthContext";
import UserScheduleCalendar from "@/components/UserScheduleCalendar";

export default function MySchedule() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">My Schedule</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Shows only your allocated time blocks, not the full appointment duration.
      </p>
      {user && <UserScheduleCalendar userId={user.id} />}
    </div>
  );
}
