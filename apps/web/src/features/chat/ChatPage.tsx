import type { FormEvent, RefObject } from "react";
import { SidePanel } from "../../components/ui/SidePanel";
import { BranchNotification } from "../branch/BranchNotification";
import { MemberList } from "../members/MemberList";
import { NotificationList } from "../members/NotificationList";
import { ConversationSearch } from "../search/ConversationSearch";
import type { ConnectionStatus } from "../../hooks/useConversationSocket";
import type { CommandContext } from "../../lib/command-input";
import type { Conversation } from "../../types/conversation";
import type { Message } from "../../types/message";
import type { ActiveMenu, ActivePanel, WorkspaceMember } from "../../types/workspace";
import { ChatHeader } from "./ChatHeader";
import { CommandHelp } from "./CommandHelp";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

type ChatPageProps = {
  conversation: Conversation | undefined;
  messages: Message[];
  loading: boolean;
  searching: boolean;
  searchResultCount: number;
  error: string;
  branchNotice: string;
  stashNotice: string;
  sidebarOpen: boolean;
  branch: string;
  branches: string[];
  connection: ConnectionStatus;
  activeMenu: ActiveMenu;
  searchOpen: boolean;
  searchQuery: string;
  panel: ActivePanel;
  panelClosing: boolean;
  workspaceMembers: WorkspaceMember[];
  conversationMembers: WorkspaceMember[];
  messageListRef: RefObject<HTMLElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  composerInputRef: RefObject<HTMLInputElement | null>;
  composerValue: string;
  commandContext: CommandContext;
  commandHistory: readonly string[];
  onComposerChange: (value: string) => void;
  onComposerSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismissError: () => void;
  onOpenCommandHelp: () => void;
  onCopyCommand: (command: string) => void;
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
  onSearchChange: (value: string) => void;
  onCloseSearch: () => void;
  onClosePanel: () => void;
  onPanelClosed: () => void;
};

export function ChatPage({
  conversation,
  messages,
  loading,
  searching,
  searchResultCount,
  error,
  branchNotice,
  stashNotice,
  sidebarOpen,
  branch,
  branches,
  connection,
  activeMenu,
  searchOpen,
  searchQuery,
  panel,
  panelClosing,
  workspaceMembers,
  conversationMembers,
  messageListRef,
  searchInputRef,
  composerInputRef,
  composerValue,
  commandContext,
  commandHistory,
  onComposerChange,
  onComposerSubmit,
  onDismissError,
  onOpenCommandHelp,
  onCopyCommand,
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
  onSearchChange,
  onCloseSearch,
  onClosePanel,
  onPanelClosed,
}: ChatPageProps) {
  return (
    <main className="chat-panel">
      {branchNotice ? (
        <BranchNotification label="BRANCH" message={branchNotice} />
      ) : stashNotice ? (
        <BranchNotification label="STASH" message={stashNotice} />
      ) : null}

      <ChatHeader
        conversation={conversation}
        sidebarOpen={sidebarOpen}
        branch={branch}
        branches={branches}
        connection={connection}
        activeMenu={activeMenu}
        onToggleSidebar={onToggleSidebar}
        onToggleBranchMenu={onToggleBranchMenu}
        onToggleMoreMenu={onToggleMoreMenu}
        onCloseMenu={onCloseMenu}
        onSelectBranch={onSelectBranch}
        onOpenSearch={onOpenSearch}
        onOpenMembers={onOpenMembers}
        onOpenSettings={onOpenSettings}
        onCopyLink={onCopyLink}
        onNotify={onNotify}
      />

      {searchOpen && (
        <ConversationSearch
          conversationName={conversation?.name ?? ""}
          query={searchQuery}
          resultCount={searchResultCount}
          inputRef={searchInputRef}
          onChange={onSearchChange}
          onClose={onCloseSearch}
        />
      )}

      <MessageList
        messages={messages}
        loading={loading}
        searching={searching}
        listRef={messageListRef}
        onCopyCommand={onCopyCommand}
      />

      <Composer
        value={composerValue}
        inputRef={composerInputRef}
        context={commandContext}
        history={commandHistory}
        error={error}
        onChange={onComposerChange}
        onSubmit={onComposerSubmit}
        onDismissError={onDismissError}
        onOpenHelp={onOpenCommandHelp}
      />

      {panel === "command-help" && (
        <SidePanel
          title="Command help"
          subtitle="Git commands you can send"
          closeLabel="Close command help"
          closing={panelClosing}
          onClose={onClosePanel}
          onClosed={onPanelClosed}
        >
          <CommandHelp />
        </SidePanel>
      )}

      {panel === "notifications" && (
        <SidePanel
          title="Notifications"
          subtitle="Recent workspace activity"
          closeLabel="Close panel"
          closing={panelClosing}
          onClose={onClosePanel}
          onClosed={onPanelClosed}
        >
          <NotificationList />
        </SidePanel>
      )}

      {panel === "workspace-members" && (
        <SidePanel
          title="Workspace members"
          subtitle={`${workspaceMembers.length} people`}
          closeLabel="Close panel"
          closing={panelClosing}
          onClose={onClosePanel}
          onClosed={onPanelClosed}
        >
          <MemberList members={workspaceMembers} variant="workspace" />
        </SidePanel>
      )}

      {panel === "conversation-members" && (
        <SidePanel
          className="chat-side-panel"
          title={
            conversation?.type === "channel"
              ? `#${conversation.name} members`
              : (conversation?.name ?? "")
          }
          subtitle={
            conversation?.type === "channel"
              ? `${conversationMembers.length} ${
                  conversationMembers.length === 1 ? "member" : "members"
                }`
              : "Direct conversation"
          }
          closeLabel="Close conversation members"
          closing={panelClosing}
          onClose={onClosePanel}
          onClosed={onPanelClosed}
        >
          <MemberList members={conversationMembers} variant="conversation" />
        </SidePanel>
      )}
    </main>
  );
}
