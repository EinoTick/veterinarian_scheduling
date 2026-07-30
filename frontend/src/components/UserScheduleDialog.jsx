import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import UserScheduleCalendar from "@/components/UserScheduleCalendar";
import { ROLE_BADGE_VARIANT as ROLE_BADGE } from "@/lib/constants";

export default function UserScheduleDialog({ user, open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>{user?.name}</DialogTitle>
            <Badge variant={ROLE_BADGE[user?.system_role] ?? "secondary"} className="shrink-0">
              {user?.system_role}
            </Badge>
          </div>
          {user?.role && (
            <p className="text-sm text-muted-foreground">{user.role.name}</p>
          )}
        </DialogHeader>
        {user && <UserScheduleCalendar userId={user.id} />}
      </DialogContent>
    </Dialog>
  );
}
