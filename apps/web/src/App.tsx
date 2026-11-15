import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ChatPage } from "./features/chat/ChatPage";
import { ConversationSidebar } from "./features/conversations/ConversationSidebar";
import { IconRail } from "./features/workspace/IconRail";
import { WorkspaceModal } from "./features/workspace/WorkspaceModal";
import { workspaceMembers } from "./data/seed";
import { useConversationSocket } from "./hooks/useConversationSocket";
import type { ConnectionStatus } from "./hooks/useConversationSocket";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSidebar } from "./hooks/useSidebar";
import { useTheme } from "./hooks/useTheme";
import { useTransientMessage } from "./hooks/useTransientMessage";
import {
  createConversation as createConversationRequest,
  getConversationBranches,
  getConversationMembers,
  getConversationMessages,
  getConversations,
  sendConversationCommand,
} from "./lib/api";
import { commandRequestId } from "./lib/commands";
import type { PendingCommand } from "./lib/commands";
import { currentBranchName } from "./lib/branches";
import {
  pushCommandHistory,
  readCommandHistory,
  writeCommandHistory,
} from "./lib/command-history";
import type { HistoryStorage } from "./lib/command-history";
import type { CommandContext } from "./lib/command-input";
import { fromApiMessage, fromConfirmedMessage, mergeMessages } from "./lib/messages";
import type {
  ApiBranch,
  ApiConversation,
  ApiMember,
  Conversation,
} from "./types/conversation";
import type { Message } from "./types/message";
import type { ActiveMenu, ActivePanel, ModalKind, WorkspaceMember } from "./types/workspace";

function toConversation(conversation: ApiConversation): Conversation {
  return {
    id: conversation.id,
    name: conversation.name,
    type: conversation.kind,
    members: conversation.memberCount,
    preview: conversation.preview ?? undefined,
    unread: conversation.unreadCount,
  };
}

function toWorkspaceMember(member: ApiMember): WorkspaceMember {
  return {
    name: member.displayName || member.handle,
    role: member.role,
    avatar: member.avatar,
  };
}

function stashNotice(input: string, count: number): string {
  if (/^git\s+stash\s+pop\b/.test(input)) {
    return "Restored from stash";
  }

  return count === 0
    ? "No stashes"
    : `${count} stashed ${count === 1 ? "message" : "messages"}`;
}

/**
 * History lives in the browser only. A blocked or full storage is not an error,
 * it just means this session has no history to recall.
 */
function browserStorage(): HistoryStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conversationMembers, setConversationMembers] = useState<
    WorkspaceMember[]
  >([]);
  const [branches, setBranches] = useState<ApiBranch[]>([]);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");

  /**
   * The request id of the last failed send, kept so a retry of the same text
   * resolves to the message the server may already have. It is scoped to the
   * conversation it was sent to, so the same words in another channel are a
   * new intent with a new id.
   */
  const [failedRequest, setFailedRequest] = useState<{
    conversationId: string;
    request: PendingCommand;
  } | null>(null);

  const [globalSearch, setGlobalSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);

  const [branch, setBranch] = useState("main");
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [panel, setPanel] = useState<ActivePanel>(null);
  const [panelClosing, setPanelClosing] = useState(false);

  const [modal, setModal] = useState<ModalKind>(null);
  const [modalClosing, setModalClosing] = useState(false);
  const [newConversationName, setNewConversationName] = useState("");

  const [toast, setToast] = useTransientMessage();
  const [branchNotice, setBranchNotice] = useTransientMessage();
  const [stashNoticeMessage, setStashNotice] = useTransientMessage();

  const { theme, setTheme, toggleTheme } = useTheme();
  const { sidebarOpen, setSidebarOpen } = useSidebar();

  const globalSearchRef = useRef<HTMLInputElement>(null);
  const chatSearchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLElement>(null);

  const active = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ?? conversations[0],
    [activeConversationId, conversations],
  );

  const activeId = active?.id ?? "";
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const storage = browserStorage();

    // oxlint-disable-next-line react/set-state-in-effect -- history is read from browser storage, an external store
    setCommandHistory(
      storage && activeId ? readCommandHistory(storage, activeId) : [],
    );
  }, [activeId]);

  const commandContext = useMemo<CommandContext>(
    () => ({
      conversationName: active?.name ?? "",
      conversationKind: active?.type ?? "channel",
      branch,
      branches: branches.map((item) => item.name),
      messages: messages.map((message) => ({
        id: message.id,
        text: message.text,
        stashed: message.stashed,
        reverted: message.reverted,
      })),
    }),
    [active?.name, active?.type, branch, branches, messages],
  );

  /**
   * A preview is the newest message in the conversation, so it may only move
   * forward in `seq`. An event delivered out of order must not rewind it.
   */
  function advancePreview(conversationId: string, text: string, seq: number) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId &&
        seq > (conversation.previewSeq ?? -1)
          ? { ...conversation, preview: text, previewSeq: seq }
          : conversation,
      ),
    );
  }

  /**
   * Catch-up path. On every socket open, including a reconnect, the client
   * refetches persisted history and merges it. SQLite is the source of truth,
   * so nothing that was committed during an outage can be missed, and the
   * merge collapses anything the client already had.
   */
  async function refreshMessages(conversationId: string) {
    try {
      const data = await getConversationMessages(conversationId);

      if (activeIdRef.current !== conversationId) {
        return;
      }

      setMessages((current) =>
        mergeMessages(current, data.map(fromApiMessage)),
      );

      // The sidebar preview normally advances on a broadcast. A client that
      // missed events while offline has to catch that up too.
      const latest = data[data.length - 1];

      if (latest) {
        advancePreview(conversationId, latest.text, latest.seq);
      }
    } catch {
      // The next reconnect retries. Sending still works over HTTP meanwhile.
      return;
    }
  }

  useConversationSocket({
    conversationId: activeId,

    onStatusChange: setConnection,

    onCatchUp(conversationId) {
      void refreshMessages(conversationId);
    },

    onMessage(message, conversationId) {
      if (activeIdRef.current !== conversationId) {
        return;
      }

      const confirmed = fromConfirmedMessage(message);

      setMessages((current) => mergeMessages(current, [confirmed]));
      advancePreview(conversationId, confirmed.text, confirmed.seq);
    },
  });

  const filteredMessages = useMemo(() => {
    // A stashed message is set aside, not deleted: history keeps it, and
    // `git stash list` is how you look at it from the chat.
    const visible = messages.filter((message) => !message.stashed);
    const query = chatSearch.trim().toLowerCase();

    if (!query) {
      return visible;
    }

    return visible.filter(
      (message) =>
        message.text.toLowerCase().includes(query) ||
        message.author.toLowerCase().includes(query) ||
        message.id.toLowerCase().includes(query),
    );
  }, [messages, chatSearch]);

  function closeFloatingMenus() {
    setActiveMenu(null);
  }

  function dismissOverlays() {
    setActiveMenu(null);
    setPanel(null);
    setPanelClosing(false);
    setChatSearchOpen(false);
    setModal(null);
    setModalClosing(false);
    setError("");
    setGlobalSearch("");
  }

  useKeyboardShortcuts({
    openGlobalSearch() {
      setSidebarOpen(true);
      setActiveMenu(null);
      setPanel(null);
      setPanelClosing(false);
      setChatSearchOpen(false);

      requestAnimationFrame(() => {
        globalSearchRef.current?.focus();
        globalSearchRef.current?.select();
      });
    },
    dismissOverlays,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      try {
        const data = await getConversations();

        if (cancelled) {
          return;
        }

        const list = data.map(toConversation);

        setConversations(list);
        setActiveConversationId((current) => {
          if (current && list.some((conversation) => conversation.id === current)) {
            return current;
          }

          return (
            list.find((conversation) => conversation.name === "engineering")
              ?.id ??
            list[0]?.id ??
            ""
          );
        });
      } catch {
        if (!cancelled) {
          setToast("Unable to load conversations");
        }
      }
    }

    void loadConversations();

    return () => {
      cancelled = true;
    };
  }, [setToast]);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    let cancelled = false;

    async function loadConversation() {
      setLoadingMessages(true);
      setMessages([]);
      setBranches([]);
      setConversationMembers([]);
      setBranch("main");

      try {
        const [messageData, branchData, memberData] = await Promise.all([
          getConversationMessages(activeId),
          getConversationBranches(activeId),
          getConversationMembers(activeId),
        ]);

        if (cancelled) {
          return;
        }

        setMessages((current) =>
          mergeMessages(current, messageData.map(fromApiMessage)),
        );

        setBranches(branchData);
        setBranch(currentBranchName(branchData));
        setConversationMembers(memberData.map(toWorkspaceMember));
      } catch {
        if (!cancelled) {
          setToast("Unable to load conversation");
        }
      } finally {
        if (!cancelled) {
          setLoadingMessages(false);
        }
      }
    }

    void loadConversation();

    return () => {
      cancelled = true;
    };
  }, [activeId, setToast]);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (messageList) {
      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  function closePanels(immediate = false) {
    if (immediate || !panel) {
      setPanel(null);
      setPanelClosing(false);
      return;
    }

    setPanelClosing(true);
  }

  function toggleMenu(next: Exclude<ActiveMenu, null>) {
    closePanels(true);
    setActiveMenu((current) => (current === next ? null : next));
  }

  function toggleSidebar() {
    closeFloatingMenus();
    closePanels(true);
    setSidebarOpen(!sidebarOpen);
  }

  function togglePanel(next: Exclude<ActivePanel, null>, closeSearch: boolean) {
    closeFloatingMenus();

    if (closeSearch) {
      setChatSearchOpen(false);
    }

    if (panel === next) {
      if (panelClosing) {
        setPanelClosing(false);
        return;
      }

      closePanels();
      return;
    }

    setPanelClosing(false);
    setPanel(next);
  }

  function openChatSearch() {
    closeFloatingMenus();
    closePanels(true);
    setChatSearchOpen(true);

    requestAnimationFrame(() => {
      chatSearchRef.current?.focus();
      chatSearchRef.current?.select();
    });
  }

  function openModal(next: Exclude<ModalKind, null>) {
    setModalClosing(false);
    setModal(next);
  }

  function closeModal() {
    if (modal) {
      setModalClosing(true);
    }
  }

  function selectConversation(id: string) {
    // Written here as well as in the effect: a frame from the previous socket
    // must not be merged into the conversation being opened.
    activeIdRef.current = id;
    setActiveConversationId(id);
    setBranch("main");

    if (window.matchMedia("(max-width: 760px)").matches) {
      setSidebarOpen(false);
    }

    closePanels(true);
    setChatSearchOpen(false);
    setChatSearch("");
    closeFloatingMenus();

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id
          ? { ...conversation, unread: 0 }
          : conversation,
      ),
    );
  }

  function selectBranch(next: string) {
    setBranch(next);
    closeFloatingMenus();
    setBranchNotice(next);
  }

  function recordCommand(value: string) {
    const next = pushCommandHistory(commandHistory, value);

    if (next === commandHistory) {
      return;
    }

    setCommandHistory([...next]);

    const storage = browserStorage();

    if (storage && activeId) {
      writeCommandHistory(storage, activeId, next);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = input.trim();

    if (!value || !activeId) {
      return;
    }

    recordCommand(value);
    setError("");

    const previous =
      failedRequest?.conversationId === activeId ? failedRequest.request : null;
    const request = commandRequestId(previous, value);

    try {
      const result = await sendConversationCommand(
        activeId,
        value,
        branch,
        request.id,
      );

      if ("message" in result) {
        const confirmed = fromConfirmedMessage(result.message);

        setMessages((current) => mergeMessages(current, [confirmed]));
        advancePreview(activeId, confirmed.text, confirmed.seq);

        setBranches((current) =>
          current.map((item) =>
            item.name === branch
              ? { ...item, headMessageId: confirmed.id }
              : item,
          ),
        );
      } else if ("branches" in result) {
        // Branch context is server state, so the answer decides where the
        // selector and the next command point.
        const next = currentBranchName(result.branches);

        if (next !== branch) {
          setBranchNotice(next);
        }

        setBranches(result.branches);
        setBranch(next);
      } else {
        setStashNotice(stashNotice(value, result.stashes.length));
      }

      setFailedRequest(null);
      // Clear only the text that was sent. A response can land while the next
      // command is already typed, and that draft belongs to the user, not to
      // this response.
      setInput((current) => (current.trim() === value ? "" : current));

      requestAnimationFrame(() => {
        composerRef.current?.focus();
      });
    } catch (submitError) {
      // The composer keeps the text, so pressing send again is a retry of this
      // same intent and reuses the id.
      setFailedRequest({ conversationId: activeId, request });

      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to send command",
      );
    }
  }

  async function handleCreateConversation() {
    const name = newConversationName.trim();

    if (!name) {
      return;
    }

    const kind = modal === "direct" ? "direct" : "channel";

    try {
      const created = await createConversationRequest({ name, kind });

      setConversations((current) => [...current, toConversation(created)]);
      selectConversation(created.id);
      setNewConversationName("");
      closeModal();

      setToast(
        kind === "direct" ? `Started conversation with ${created.name}` : `Created #${created.name}`,
      );
    } catch (createError) {
      setToast(
        createError instanceof Error
          ? createError.message
          : "Unable to create conversation",
      );
    }
  }

  async function copyChannelLink() {
    const url = `${window.location.origin}/c/${active?.id}`;

    try {
      await navigator.clipboard.writeText(url);
      setToast("Conversation link copied");
    } catch {
      setToast("Unable to copy conversation link");
    }
  }

  async function copyMessageCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setToast("Git command copied");
    } catch {
      setToast("Unable to copy command");
    }
  }

  return (
    <div
      className={`app-shell ${
        sidebarOpen ? "sidebar-open" : "sidebar-collapsed"
      }`}
    >
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close conversation list"
        />
      )}

      <IconRail
        sidebarOpen={sidebarOpen}
        panel={panel}
        activeMenu={activeMenu}
        theme={theme}
        onToggleSidebar={toggleSidebar}
        onHome={() => closePanels()}
        onOpenPanel={(next) => togglePanel(next, true)}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => {
          closeFloatingMenus();
          closePanels(true);
          openModal("settings");
        }}
        onToggleProfileMenu={() => toggleMenu("profile")}
        onCloseMenu={closeFloatingMenus}
        setTheme={setTheme}
        onNotify={setToast}
      />

      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeId}
        search={globalSearch}
        searchInputRef={globalSearchRef}
        onSearchChange={setGlobalSearch}
        onSelect={selectConversation}
        onNewChannel={() => {
          closeFloatingMenus();
          closePanels(true);
          openModal("channel");
        }}
        onNewDirect={() => {
          closeFloatingMenus();
          closePanels(true);
          openModal("direct");
        }}
      />

      <ChatPage
        conversation={active}
        messages={filteredMessages}
        loading={loadingMessages}
        searching={chatSearch.trim() !== ""}
        searchResultCount={filteredMessages.length}
        error={error}
        branchNotice={branchNotice}
        stashNotice={stashNoticeMessage}
        sidebarOpen={sidebarOpen}
        branch={branch}
        branches={branches.map((item) => item.name)}
        connection={connection}
        activeMenu={activeMenu}
        searchOpen={chatSearchOpen}
        searchQuery={chatSearch}
        panel={panel}
        panelClosing={panelClosing}
        workspaceMembers={workspaceMembers}
        conversationMembers={conversationMembers}
        messageListRef={messageListRef}
        searchInputRef={chatSearchRef}
        composerInputRef={composerRef}
        composerValue={input}
        commandContext={commandContext}
        commandHistory={commandHistory}
        onComposerChange={(value) => {
          setInput(value);
          setError("");
        }}
        onComposerSubmit={handleSubmit}
        onDismissError={() => setError("")}
        onOpenCommandHelp={() => togglePanel("command-help", true)}
        onCopyCommand={(command) => void copyMessageCommand(command)}
        onToggleSidebar={toggleSidebar}
        onToggleBranchMenu={() => toggleMenu("branch")}
        onToggleMoreMenu={() => toggleMenu("more")}
        onCloseMenu={closeFloatingMenus}
        onSelectBranch={selectBranch}
        onOpenSearch={openChatSearch}
        onOpenMembers={() => togglePanel("conversation-members", false)}
        onOpenSettings={() => openModal("settings")}
        onCopyLink={() => void copyChannelLink()}
        onNotify={setToast}
        onSearchChange={setChatSearch}
        onCloseSearch={() => {
          setChatSearch("");
          setChatSearchOpen(false);
        }}
        onClosePanel={() => closePanels()}
        onPanelClosed={() => {
          setPanel(null);
          setPanelClosing(false);
        }}
      />

      {modal && (
        <WorkspaceModal
          kind={modal}
          closing={modalClosing}
          theme={theme}
          name={newConversationName}
          onNameChange={setNewConversationName}
          onCreate={() => void handleCreateConversation()}
          onToggleTheme={toggleTheme}
          onClose={closeModal}
          onClosed={() => {
            setModal(null);
            setModalClosing(false);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
