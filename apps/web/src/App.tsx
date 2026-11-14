import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ChatPage } from "./features/chat/ChatPage";
import { ConversationSidebar } from "./features/conversations/ConversationSidebar";
import { IconRail } from "./features/workspace/IconRail";
import { WorkspaceModal } from "./features/workspace/WorkspaceModal";
import {
  branches,
  initialConversations,
  seedMessages,
  workspaceMembers,
} from "./data/seed";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSidebar } from "./hooks/useSidebar";
import { useTheme } from "./hooks/useTheme";
import { useTransientMessage } from "./hooks/useTransientMessage";
import { getMessages, sendCommand } from "./lib/api";
import { formatTime } from "./lib/format";
import type { Conversation } from "./types/conversation";
import type { Message } from "./types/message";
import type { ActiveMenu, ActivePanel, ModalKind } from "./types/workspace";

function buildMessage(
  id: string,
  author: string,
  text: string,
  command: string,
  createdAt: string,
): Message {
  return {
    id,
    author,
    avatar: author.charAt(0).toUpperCase(),
    text,
    command: `${command} -m "${text}"`,
    time: formatTime(createdAt),
    mine: author === "grok08",
  };
}

function App() {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState("engineering");
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");

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

  const filteredMessages = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();

    if (!query) {
      return messages;
    }

    return messages.filter(
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
    let active = true;

    async function loadMessages() {
      setLoadingMessages(true);

      try {
        const data = await getMessages();

        if (active && data.length > 0) {
          setMessages(
            data.map((message) =>
              buildMessage(
                message.id,
                message.author,
                message.text,
                message.command,
                message.created_at,
              ),
            ),
          );
        }
      } catch {
        // Keep the seed messages when the API is not running.
      } finally {
        if (active) {
          setLoadingMessages(false);
        }
      }
    }

    void loadMessages();

    return () => {
      active = false;
    };
  }, []);

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
    setActiveConversationId(id);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = input.trim();

    if (!value) {
      return;
    }

    setError("");

    try {
      const message = await sendCommand(value, "grok08");

      setMessages((current) => [
        ...current,
        buildMessage(
          message.id,
          message.author,
          message.text,
          message.command,
          message.createdAt,
        ),
      ]);

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeConversationId
            ? { ...conversation, preview: message.text }
            : conversation,
        ),
      );

      setInput("");

      requestAnimationFrame(() => {
        composerRef.current?.focus();
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to send command",
      );
    }
  }

  function createConversation() {
    const name = newConversationName.trim();

    if (!name) {
      return;
    }

    const id = name.toLowerCase().replace(/\s+/g, "-");

    if (conversations.some((conversation) => conversation.id === id)) {
      setToast("That conversation already exists");
      return;
    }

    const isDirect = modal === "direct";

    const conversation: Conversation = {
      id,
      name,
      type: isDirect ? "direct" : "channel",
      members: isDirect ? undefined : 1,
      preview: "No messages yet",
    };

    setConversations((current) => [...current, conversation]);

    setActiveConversationId(id);
    setNewConversationName("");
    closeModal();

    setToast(
      isDirect ? `Started conversation with ${name}` : `Created #${name}`,
    );
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
        activeConversationId={activeConversationId}
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
        sidebarOpen={sidebarOpen}
        branch={branch}
        branches={branches}
        activeMenu={activeMenu}
        searchOpen={chatSearchOpen}
        searchQuery={chatSearch}
        panel={panel}
        panelClosing={panelClosing}
        workspaceMembers={workspaceMembers}
        messageListRef={messageListRef}
        searchInputRef={chatSearchRef}
        composerInputRef={composerRef}
        composerValue={input}
        onComposerChange={setInput}
        onComposerSubmit={handleSubmit}
        onDismissError={() => setError("")}
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
          onCreate={createConversation}
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
