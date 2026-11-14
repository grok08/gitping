import { Bell, Hash, Moon, Settings, Sun, Users } from "lucide-react";
import type { ActiveMenu, ActivePanel, Theme } from "../../types/workspace";

type IconRailProps = {
  sidebarOpen: boolean;
  panel: ActivePanel;
  activeMenu: ActiveMenu;
  theme: Theme;
  onToggleSidebar: () => void;
  onHome: () => void;
  onOpenPanel: (panel: "notifications" | "workspace-members") => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onToggleProfileMenu: () => void;
  onCloseMenu: () => void;
  setTheme: (theme: Theme) => void;
  onNotify: (message: string) => void;
};

export function IconRail({
  sidebarOpen,
  panel,
  activeMenu,
  theme,
  onToggleSidebar,
  onHome,
  onOpenPanel,
  onToggleTheme,
  onOpenSettings,
  onToggleProfileMenu,
  onCloseMenu,
  setTheme,
  onNotify,
}: IconRailProps) {
  return (
    <aside className="icon-sidebar">
      <button
        className={`brand ${
          sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"
        }`}
        type="button"
        onClick={onToggleSidebar}
        aria-label={
          sidebarOpen
            ? "Collapse conversation sidebar"
            : "Expand conversation sidebar"
        }
        title={
          sidebarOpen
            ? "Collapse conversation sidebar"
            : "Expand conversation sidebar"
        }
      >
        G
      </button>

      <button
        className="rail-button active"
        type="button"
        onClick={onHome}
        aria-label="Home"
        title="Home"
      >
        <Hash size={18} />
      </button>

      <button
        className={`rail-button ${
          panel === "notifications" ? "active" : ""
        }`}
        type="button"
        onClick={() => onOpenPanel("notifications")}
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={18} />
      </button>

      <button
        className={`rail-button ${
          panel === "workspace-members" ? "active" : ""
        }`}
        type="button"
        onClick={() => onOpenPanel("workspace-members")}
        aria-label="Workspace members"
        title="Workspace members"
      >
        <Users size={18} />
      </button>

      <div className="rail-spacer" />

      <button
        className="rail-button"
        type="button"
        onClick={onToggleTheme}
        aria-label="Toggle theme"
        title="Toggle theme"
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <button
        className="rail-button"
        type="button"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={18} />
      </button>

      <button
        className="user-avatar"
        type="button"
        onClick={onToggleProfileMenu}
        aria-label="Open profile"
        title="Profile"
      >
        G
      </button>

      {activeMenu === "profile" && (
        <div className="floating-menu profile-menu">
          <strong>grok08</strong>
          <span>GitHub developer</span>

          <button
            type="button"
            onClick={() => {
              setTheme("light");
              onCloseMenu();
              onNotify("Light mode enabled");
            }}
          >
            Use light mode
          </button>

          <button
            type="button"
            onClick={() => {
              setTheme("dark");
              onCloseMenu();
              onNotify("Dark mode enabled");
            }}
          >
            Use dark mode
          </button>
        </div>
      )}
    </aside>
  );
}
