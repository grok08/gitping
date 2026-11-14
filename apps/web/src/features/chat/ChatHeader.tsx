import { Bell, Copy, Hash, Menu, Search, Settings, Users } from "lucide-react";
import { useState } from "react";
import { BranchSelector } from "../branch/BranchSelector";
import type { Conversation } from "../../types/conversation";
import type { ActiveMenu } from "../../types/workspace";

type ChatHeaderProps = {
  conversation: Conversation | undefined;
  sidebarOpen: boolean;
  branch: string;
  branches: string[];
  activeMenu: ActiveMenu;
  onToggleSidebar: () => void;
  onToggleBranchMenu: () => void;
  onToggleMoreMenu: () => void;
  onCloseMenu: () => void;
  onSelectBranch: (branch: string) => void;
  onOpenSearch: () => void;
  onOpenMembers: () => void;
  onOpenSettings: () => void;
  onCopyLink: () => void;
  onNotify: (message: string) => void;
};

export function ChatHeader({
  conversation,
  sidebarOpen,
  branch,
  branches,
  activeMenu,
  onToggleSidebar,
  onToggleBranchMenu,
  onToggleMoreMenu,
  onCloseMenu,
  onSelectBranch,
  onOpenSearch,
  onOpenMembers,
  onOpenSettings,
  onCopyLink,
  onNotify,
}: ChatHeaderProps) {
  const [muted, setMuted] = useState(false);

  return (
    <header className="chat-header">
      <div className="chat-header-main">
        <button
          className="mobile-menu"
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
          title={sidebarOpen ? "Close navigation" : "Open navigation"}
        >
          <Menu size={18} />
        </button>

        <div>
          <div className="chat-title">
            <Hash size={17} />
            {conversation?.name}
          </div>

          <div className="chat-meta">
            {conversation?.type === "channel"
              ? `${conversation.members ?? 0} ${
                  conversation.members === 1 ? "member" : "members"
                }`
              : "Direct conversation"}

            <span className="meta-dot">•</span>

            <BranchSelector
              branch={branch}
              branches={branches}
              open={activeMenu === "branch"}
              onToggle={onToggleBranchMenu}
              onSelect={onSelectBranch}
            />
          </div>
        </div>
      </div>

      <div className="chat-actions">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search this conversation"
          title="Search this conversation"
        >
          <Search size={17} />
        </button>

        <button
          type="button"
          onClick={onOpenMembers}
          aria-label="View conversation members"
          title="Conversation members"
        >
          <Users size={17} />
        </button>

        <button
          type="button"
          onClick={onToggleMoreMenu}
          aria-label="More"
          title="More"
        >
          ···
        </button>

        {activeMenu === "more" && (
          <div className="floating-menu header-menu">
            <button
              type="button"
              onClick={() => {
                onCopyLink();
                onCloseMenu();
              }}
            >
              <Copy size={14} />
              Copy conversation link
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !muted;

                setMuted(next);
                onCloseMenu();
                onNotify(
                  next ? "Conversation muted" : "Conversation unmuted",
                );
              }}
            >
              <Bell size={14} />
              {muted ? "Unmute conversation" : "Mute conversation"}
            </button>

            <button
              type="button"
              onClick={() => {
                onCloseMenu();
                onOpenSettings();
              }}
            >
              <Settings size={14} />
              Conversation settings
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
