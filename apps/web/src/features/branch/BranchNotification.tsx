import { Check } from "lucide-react";

export function BranchNotification({ message }: { message: string }) {
  return (
    <div className="dynamic-island" role="status" aria-live="polite">
      <span className="dynamic-island-icon">
        <Check size={13} />
      </span>

      <div className="dynamic-island-content">
        <span className="dynamic-island-label">BRANCH</span>

        <strong>{message}</strong>
      </div>
    </div>
  );
}
