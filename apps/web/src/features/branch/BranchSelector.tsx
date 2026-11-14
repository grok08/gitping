import { Check, ChevronDown, GitBranch } from "lucide-react";

type BranchSelectorProps = {
  branch: string;
  branches: string[];
  open: boolean;
  onToggle: () => void;
  onSelect: (branch: string) => void;
};

export function BranchSelector({
  branch,
  branches,
  open,
  onToggle,
  onSelect,
}: BranchSelectorProps) {
  return (
    <div className="branch-wrapper">
      <button className="branch-button" type="button" onClick={onToggle}>
        <GitBranch size={13} />
        {branch}
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="floating-menu branch-menu">
          <div className="menu-title">BRANCH</div>

          {branches.map((item) => (
            <button
              key={item}
              type="button"
              className={item === branch ? "menu-selected" : ""}
              onClick={() => onSelect(item)}
            >
              {item === branch ? (
                <Check size={14} />
              ) : (
                <span className="menu-check-space" />
              )}

              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
