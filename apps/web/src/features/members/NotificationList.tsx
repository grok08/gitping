import { Bell, Hash } from "lucide-react";

export function NotificationList() {
  return (
    <>
      <div className="notification-item">
        <Bell size={15} />

        <div>
          <strong>engineering</strong>
          <span>3 unread messages</span>
        </div>
      </div>

      <div className="notification-item">
        <Hash size={15} />

        <div>
          <strong>weekend</strong>
          <span>New conversation</span>
        </div>
      </div>
    </>
  );
}
