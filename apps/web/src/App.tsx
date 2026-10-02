import {
  Bell,
  Check,
  ChevronDown,
  Copy,
  Hash,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

import {
  getMessages,
  sendCommand,
} from "./lib/app";

type Theme = "light" | "dark";

type Message = {
  id: string;
  author: string;
  avatar: string;
  text: string;
  command: string;
  time: string;
  mine?: boolean;
};

type Conversation = {
  id: string;
  name: string;
  type: "channel" | "direct";
  unread?: number;
  members?: number;
  preview?: string;
};

type GlobalPanel = "notifications" | "members" | null;
type ChatPanel = "members" | null;
type Modal = "channel" | "direct" | "settings" | null;

const initialConversations: Conversation[] = [
  {
    id: "general",
    name: "general",
    type: "channel",
    members: 24,
    preview: "Welcome to GitPing",
  },
  {
    id: "engineering",
    name: "engineering",
    type: "channel",
    members: 18,
    unread: 3,
    preview: "Let's ship this",
  },
  {
    id: "random",
    name: "random",
    type: "channel",
    members: 31,
    preview: "Weekend plans?",
  },
  {
    id: "weekend",
    name: "weekend",
    type: "channel",
    preview: "git switch weekend",
  },
  {
    id: "rahul",
    name: "rahul",
    type: "direct",
    unread: 1,
    preview: "are you free?",
  },
  {
    id: "alice",
    name: "alice",
    type: "direct",
    preview: "see you tomorrow",
  },
];

const seedMessages: Message[] = [
  {
    id: "a81f2c",
    author: "rahul",
    avatar: "R",
    text: "what are you doing?",
    command: 'git commit -m "what are you doing?"',
    time: "8:42 PM",
  },
  {
    id: "b71f92",
    author: "grok08",
    avatar: "G",
    text: "working on GitPing",
    command: 'git commit -m "working on GitPing"',
    time: "8:43 PM",
  },
  {
    id: "c44ab1",
    author: "rahul",
    avatar: "R",
    text: "this is actually a fun idea",
    command: 'git commit -m "this is actually a fun idea"',
    time: "8:44 PM",
  },
  {
    id: "d51e73",
    author: "grok08",
    avatar: "G",
    text: "let's see where it goes",
    command: 'git commit -m "let\'s see where it goes"',
    time: "8:45 PM",
    mine: true,
  },
];

const branches = ["main", "weekend", "feature-ui"];

const workspaceMembers = [
  { name: "grok08", role: "You", avatar: "G", online: true },
  { name: "rahul", role: "Developer", avatar: "R", online: true },
  { name: "alice", role: "Developer", avatar: "A", online: true },
  { name: "maria", role: "Developer", avatar: "M", online: false },
];

function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function mapApiMessage(message: {
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
}): Message {
  return {
    id: message.id,
    author: message.author,
    avatar: message.author.charAt(0).toUpperCase(),
    text: message.text,
    command: `${message.command} -m "${message.text}"`,
    time: formatTime(message.created_at),
    mine: message.author === "grok08",
  };
}

function App() {
  const [activeConversation, setActiveConversation] =
    useState("engineering");

  const [conversations, setConversations] = useState(
    initialConversations,
  );

  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [input, setInput] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem("gitping-sidebar") !== "closed";
  });

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("gitping-theme");

    if (saved === "light" || saved === "dark") {
      return saved;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  const [branch, setBranch] = useState("main");
  const [branchOpen, setBranchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const [globalPanel, setGlobalPanel] =
    useState<GlobalPanel>(null);

  const [chatPanel, setChatPanel] = useState<ChatPanel>(null);

  const [modal, setModal] = useState<Modal>(null);
  const [newConversationName, setNewConversationName] =
    useState("");

  const [error, setError] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState("");
  const [branchNotice, setBranchNotice] = useState("");

  const globalSearchRef = useRef<HTMLInputElement>(null);
  const chatSearchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLElement>(null);

  const active = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversation,
      ) ?? conversations[0],
    [activeConversation, conversations],
  );

  const filteredConversations = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();

    if (!query) {
      return conversations;
    }

    return conversations.filter(
      (conversation) =>
        conversation.name.toLowerCase().includes(query) ||
        conversation.preview?.toLowerCase().includes(query),
    );
  }, [conversations, globalSearch]);

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("gitping-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      "gitping-sidebar",
      sidebarOpen ? "open" : "closed",
    );
  }, [sidebarOpen]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();

        setSidebarOpen(true);
        setGlobalPanel(null);
        setChatPanel(null);
        setChatSearchOpen(false);
        setBranchOpen(false);
        setMoreOpen(false);
        setProfileOpen(false);

        requestAnimationFrame(() => {
          globalSearchRef.current?.focus();
          globalSearchRef.current?.select();
        });

        return;
      }

      if (event.key === "Escape") {
        setBranchOpen(false);
        setMoreOpen(false);
        setProfileOpen(false);
        setGlobalPanel(null);
        setChatPanel(null);
        setChatSearchOpen(false);
        setModal(null);
        setError("");
        setGlobalSearch("");
      }
    }

    window.addEventListener("keydown", handleShortcut);

    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, []);

  useEffect(() => {
    async function loadMessages() {
      setLoadingMessages(true);

      try {
        const data = await getMessages();

        if (data.length > 0) {
          setMessages(data.map(mapApiMessage));
        }
      } catch {
        // Keep seed messages if the API isn't available.
      } finally {
        setLoadingMessages(false);
      }
    }

    void loadMessages();
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

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast("");
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  useEffect(() => {
    if (!branchNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setBranchNotice("");
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [branchNotice]);

  function showToast(message: string) {
    setToast(message);
  }

  function closeFloatingMenus() {
    setBranchOpen(false);
    setMoreOpen(false);
    setProfileOpen(false);
  }

  function toggleSidebar() {
    closeFloatingMenus();
    setGlobalPanel(null);
    setChatPanel(null);
    setSidebarOpen((current) => !current);
  }

  function openGlobalPanel(panel: Exclude<GlobalPanel, null>) {
    closeFloatingMenus();
    setChatPanel(null);
    setChatSearchOpen(false);

    setGlobalPanel((current) =>
      current === panel ? null : panel,
    );
  }

  function openChatMembers() {
    closeFloatingMenus();
    setGlobalPanel(null);

    setChatPanel((current) =>
      current === "members" ? null : "members",
    );
  }

  function openChatSearch() {
    closeFloatingMenus();
    setGlobalPanel(null);
    setChatPanel(null);
    setChatSearchOpen(true);

    requestAnimationFrame(() => {
      chatSearchRef.current?.focus();
      chatSearchRef.current?.select();
    });
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const value = input.trim();

    if (!value) {
      return;
    }

    setError("");

    try {
      const message = await sendCommand(
        value,
        "grok08",
      );

      setMessages((current) => [
        ...current,
        {
          id: message.id,
          author: message.author,
          avatar: message.author.charAt(0).toUpperCase(),
          text: message.text,
          command: `${message.command} -m "${message.text}"`,
          time: formatTime(message.createdAt),
          mine: message.author === "grok08",
        },
      ]);

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeConversation
            ? {
                ...conversation,
                preview: message.text,
              }
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

    if (
      conversations.some(
        (conversation) => conversation.id === id,
      )
    ) {
      showToast("That conversation already exists");
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

    setConversations((current) => [
      ...current,
      conversation,
    ]);

    setActiveConversation(id);
    setNewConversationName("");
    setModal(null);

    showToast(
      isDirect
        ? `Started conversation with ${name}`
        : `Created #${name}`,
    );
  }

  async function copyChannelLink() {
    const url = `${window.location.origin}/c/${active?.id}`;

    try {
      await navigator.clipboard.writeText(url);
      showToast("Conversation link copied");
    } catch {
      showToast("Unable to copy conversation link");
    }

    setMoreOpen(false);
  }

  async function copyMessageCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      showToast("Git command copied");
    } catch {
      showToast("Unable to copy command");
    }
  }

  function selectConversation(id: string) {
    setActiveConversation(id);
    setGlobalPanel(null);
    setChatPanel(null);
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

  return (
    <div
      className={`app-shell ${
        sidebarOpen ? "sidebar-open" : "sidebar-collapsed"
      }`}
    >
      {branchNotice && (
        <div
          className="dynamic-island"
          role="status"
          aria-live="polite"
        >
          <span className="dynamic-island-icon">
            <Check size={13} />
          </span>

          <div className="dynamic-island-content">
            <span className="dynamic-island-label">
              BRANCH
            </span>

            <strong>{branchNotice}</strong>
          </div>
        </div>
      )}

      {/* LEFT RAIL */}
      <aside className="icon-sidebar">
        <button
          className={`brand ${
            sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"
          }`}
          type="button"
          onClick={toggleSidebar}
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
          onClick={() => {
            setGlobalPanel(null);
            setChatPanel(null);
          }}
          aria-label="Home"
          title="Home"
        >
          <Hash size={18} />
        </button>

        <button
          className={`rail-button ${
            globalPanel === "notifications" ? "active" : ""
          }`}
          type="button"
          onClick={() =>
            openGlobalPanel("notifications")
          }
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell size={18} />
        </button>

        <button
          className={`rail-button ${
            globalPanel === "members" ? "active" : ""
          }`}
          type="button"
          onClick={() => openGlobalPanel("members")}
          aria-label="Workspace members"
          title="Workspace members"
        >
          <Users size={18} />
        </button>

        <div className="rail-spacer" />

        <button
          className="rail-button"
          type="button"
          onClick={() =>
            setTheme((current) =>
              current === "dark" ? "light" : "dark",
            )
          }
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun size={18} />
          ) : (
            <Moon size={18} />
          )}
        </button>

        <button
          className={`rail-button ${
            modal === "settings" ? "active" : ""
          }`}
          type="button"
          onClick={() => {
            closeFloatingMenus();
            setGlobalPanel(null);
            setChatPanel(null);
            setModal("settings");
          }}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </button>

        <button
          className="user-avatar"
          type="button"
          onClick={() => {
            closeFloatingMenus();
            setGlobalPanel(null);
            setChatPanel(null);
            setProfileOpen((current) => !current);
          }}
          aria-label="Open profile"
          title="Profile"
        >
          G
        </button>

        {profileOpen && (
          <div className="floating-menu profile-menu">
            <strong>grok08</strong>
            <span>GitHub developer</span>

            <button
              type="button"
              onClick={() => {
                setTheme("light");
                setProfileOpen(false);
                showToast("Light mode enabled");
              }}
            >
              Use light mode
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme("dark");
                setProfileOpen(false);
                showToast("Dark mode enabled");
              }}
            >
              Use dark mode
            </button>
          </div>
        )}
      </aside>

      {/* CONVERSATION SIDEBAR */}
      <aside className="conversation-sidebar">
        <div className="workspace-header">
          <div>
            <div className="workspace-name">GitPing</div>
            <div className="workspace-subtitle">
              Developer workspace
            </div>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={() => {
              closeFloatingMenus();
              setGlobalPanel(null);
              setChatPanel(null);
              setModal("channel");
            }}
            aria-label="New channel"
            title="New channel"
          >
            <Plus size={17} />
          </button>
        </div>

        <div className="search-box">
          <Search size={15} />

          <input
            ref={globalSearchRef}
            value={globalSearch}
            onChange={(event) =>
              setGlobalSearch(event.target.value)
            }
            placeholder="Search conversations"
          />

          {globalSearch ? (
            <button
              className="search-clear"
              type="button"
              onClick={() => setGlobalSearch("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd>
              {navigator.platform
                .toLowerCase()
                .includes("mac")
                ? "⌘ K"
                : "Ctrl K"}
            </kbd>
          )}
        </div>

        <div className="conversation-scroll">
          <section className="conversation-section">
            <div className="section-header">
              <span>CHANNELS</span>

              <button
                type="button"
                onClick={() => {
                  closeFloatingMenus();
                  setGlobalPanel(null);
                  setChatPanel(null);
                  setModal("channel");
                }}
                aria-label="Add channel"
              >
                <Plus size={14} />
              </button>
            </div>

            {filteredConversations
              .filter(
                (conversation) =>
                  conversation.type === "channel",
              )
              .map((conversation) => (
                <button
                  className={`conversation-item ${
                    activeConversation === conversation.id
                      ? "selected"
                      : ""
                  }`}
                  key={conversation.id}
                  onClick={() =>
                    selectConversation(conversation.id)
                  }
                  type="button"
                >
                  <Hash size={15} />

                  <span className="conversation-name">
                    {conversation.name}
                  </span>

                  {conversation.unread ? (
                    <span className="unread-count">
                      {conversation.unread}
                    </span>
                  ) : null}
                </button>
              ))}
          </section>

          <section className="conversation-section">
            <div className="section-header">
              <span>DIRECT MESSAGES</span>

              <button
                type="button"
                onClick={() => {
                  closeFloatingMenus();
                  setGlobalPanel(null);
                  setChatPanel(null);
                  setModal("direct");
                }}
                aria-label="New direct message"
              >
                <Plus size={14} />
              </button>
            </div>

            {filteredConversations
              .filter(
                (conversation) =>
                  conversation.type === "direct",
              )
              .map((conversation) => (
                <button
                  className={`conversation-item ${
                    activeConversation === conversation.id
                      ? "selected"
                      : ""
                  }`}
                  key={conversation.id}
                  onClick={() =>
                    selectConversation(conversation.id)
                  }
                  type="button"
                >
                  <span className="presence-dot" />

                  <span className="conversation-name">
                    {conversation.name}
                  </span>

                  {conversation.unread ? (
                    <span className="unread-count">
                      {conversation.unread}
                    </span>
                  ) : null}
                </button>
              ))}
          </section>
        </div>
      </aside>

      {/* MAIN CHAT */}
      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-header-main">
            <button
              className="mobile-menu"
              type="button"
              onClick={() =>
                setSidebarOpen(true)
              }
              aria-label="Open navigation"
            >
              <Menu size={18} />
            </button>

            <div>
              <div className="chat-title">
                <Hash size={17} />
                {active?.name}
              </div>

              <div className="chat-meta">
                {active?.members
                  ? `${active.members} members`
                  : "Direct conversation"}

                <span className="meta-dot">•</span>

                <div className="branch-wrapper">
                  <button
                    className="branch-button"
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      setProfileOpen(false);
                      setGlobalPanel(null);
                      setChatPanel(null);
                      setBranchOpen((current) => !current);
                    }}
                  >
                    {branch}
                    <ChevronDown size={13} />
                  </button>

                  {branchOpen && (
                    <div className="floating-menu branch-menu">
                      <div className="menu-title">
                        BRANCH
                      </div>

                      {branches.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={
                            item === branch
                              ? "menu-selected"
                              : ""
                          }
                          onClick={() => {
                            setBranch(item);
                            setBranchOpen(false);
                            setBranchNotice(item);
                          }}
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
              </div>
            </div>
          </div>

          <div className="chat-actions">
            <button
              type="button"
              onClick={openChatSearch}
              aria-label="Search this conversation"
              title="Search this conversation"
            >
              <Search size={17} />
            </button>

            <button
              type="button"
              onClick={openChatMembers}
              aria-label="View conversation members"
              title="Conversation members"
            >
              <Users size={17} />
            </button>

            <button
              type="button"
              onClick={() => {
                setBranchOpen(false);
                setProfileOpen(false);
                setGlobalPanel(null);
                setChatPanel(null);
                setMoreOpen((current) => !current);
              }}
              aria-label="More"
              title="More"
            >
              ···
            </button>

            {moreOpen && (
              <div className="floating-menu header-menu">
                <button
                  type="button"
                  onClick={() => void copyChannelLink()}
                >
                  <Copy size={14} />
                  Copy conversation link
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    setMoreOpen(false);
                    showToast(
                      next
                        ? "Conversation muted"
                        : "Conversation unmuted",
                    );
                  }}
                >
                  <Bell size={14} />
                  {muted
                    ? "Unmute conversation"
                    : "Mute conversation"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setModal("settings");
                  }}
                >
                  <Settings size={14} />
                  Conversation settings
                </button>
              </div>
            )}
          </div>
        </header>

        {chatSearchOpen && (
          <div className="chat-search-bar">
            <div className="chat-search-inner">
              <Search size={15} />

              <input
                ref={chatSearchRef}
                value={chatSearch}
                onChange={(event) =>
                  setChatSearch(event.target.value)
                }
                placeholder={`Search in #${active?.name}`}
              />

              {chatSearch && (
                <span className="chat-search-count">
                  {filteredMessages.length}{" "}
                  {filteredMessages.length === 1
                    ? "result"
                    : "results"}
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  setChatSearch("");
                  setChatSearchOpen(false);
                }}
                aria-label="Close conversation search"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        <section
          className="message-list"
          ref={messageListRef}
        >
          <div className="message-content">
            <div className="message-day">TODAY</div>

            {loadingMessages ? (
              <div className="empty-state">
                Loading messages…
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="empty-state">
                {chatSearch
                  ? "No messages match your search."
                  : "No messages yet."}
              </div>
            ) : (
              filteredMessages.map((message) => (
                <article
                  className="message-row"
                  key={message.id}
                >
                  <div
                    className={`avatar ${
                      message.mine ? "mine" : ""
                    }`}
                  >
                    {message.avatar}
                  </div>

                  <div className="message-body">
                    <div className="message-header">
                      <span className="message-author">
                        {message.author}
                      </span>

                      <span className="message-time">
                        {message.time}
                      </span>
                    </div>

                    <div className="message-text">
                      {message.text}
                    </div>

                    <div className="message-footer">
                      <span className="commit-pill">
                        commit
                      </span>

                      <span className="commit-id">
                        {message.id.slice(0, 8)}
                      </span>

                      <button
                        className="message-copy"
                        type="button"
                        onClick={() =>
                          void copyMessageCommand(
                            message.command,
                          )
                        }
                        aria-label="Copy Git command"
                        title="Copy Git command"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}

            {error && (
              <div className="command-error">
                <span>{error}</span>

                <button
                  type="button"
                  onClick={() => setError("")}
                  aria-label="Dismiss error"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </section>

        <footer className="composer-tray">
          <div className="composer-content">
            <form
              className="composer"
              onSubmit={handleSubmit}
            >
              <span className="composer-prompt">$</span>

              <input
                ref={composerRef}
                autoFocus
                value={input}
                onChange={(event) =>
                  setInput(event.target.value)
                }
                placeholder='git commit -m "message"'
                spellCheck={false}
              />

              <button
                className="send-button"
                disabled={!input.trim()}
                type="submit"
                aria-label="Send command"
              >
                ↵
              </button>
            </form>

            <div className="composer-help">
              <span>
                Communicate with{" "}
                <strong>Git commands</strong>
              </span>

              <span>Enter to send</span>
            </div>
          </div>
        </footer>

        {globalPanel && (
          <aside className="side-panel">
            <div className="side-panel-header">
              <div>
                <strong>
                  {globalPanel === "members"
                    ? "Workspace members"
                    : "Notifications"}
                </strong>

                <span>
                  {globalPanel === "members"
                    ? `${workspaceMembers.length} people`
                    : "Recent workspace activity"}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setGlobalPanel(null)}
                aria-label="Close panel"
              >
                <X size={17} />
              </button>
            </div>

            {globalPanel === "members" ? (
              <div className="side-panel-content">
                {workspaceMembers.map((member) => (
                  <div className="member-row" key={member.name}>
                    <div
                      className={`avatar ${
                        member.name === "grok08" ? "mine" : ""
                      }`}
                    >
                      {member.avatar}
                    </div>

                    <div>
                      <strong>{member.name}</strong>
                      <span>{member.role}</span>
                    </div>

                    <span
                      className={
                        member.online
                          ? "presence-dot"
                          : "presence-dot offline"
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="side-panel-content">
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
              </div>
            )}
          </aside>
        )}

        {chatPanel === "members" && (
          <aside className="side-panel chat-side-panel">
            <div className="side-panel-header">
              <div>
                <strong>
                  {active?.type === "channel"
                    ? `#${active.name} members`
                    : active?.name}
                </strong>

                <span>
                  {active?.members
                    ? `${active.members} members`
                    : "Direct conversation"}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setChatPanel(null)}
                aria-label="Close conversation members"
              >
                <X size={17} />
              </button>
            </div>

            <div className="side-panel-content">
              {workspaceMembers
                .slice(
                  0,
                  active?.members
                    ? Math.min(3, active.members)
                    : 2,
                )
                .map((member) => (
                  <div
                    className="member-row"
                    key={member.name}
                  >
                    <div
                      className={`avatar ${
                        member.name === "grok08" ? "mine" : ""
                      }`}
                    >
                      {member.avatar}
                    </div>

                    <div>
                      <strong>{member.name}</strong>

                      <span>
                        {member.name === "grok08"
                          ? "You"
                          : "Member"}
                      </span>
                    </div>

                    <span
                      className={
                        member.online
                          ? "presence-dot"
                          : "presence-dot offline"
                      }
                    />
                  </div>
                ))}
            </div>
          </aside>
        )}
      </main>

      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setModal(null)}
        >
          <div
            className="modal"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <strong>
                  {modal === "channel"
                    ? "Create channel"
                    : modal === "direct"
                      ? "New direct message"
                      : "Settings"}
                </strong>

                <span>
                  {modal === "channel"
                    ? "Create a new Git conversation"
                    : modal === "direct"
                      ? "Start talking to a developer"
                      : "GitPing preferences"}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setModal(null)}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            {modal === "settings" ? (
              <div className="settings-content">
                <div className="setting-row">
                  <div>
                    <strong>Theme</strong>

                    <span>
                      Switch between light and dark mode
                    </span>
                  </div>

                  <button
                    className="setting-control"
                    type="button"
                    onClick={() =>
                      setTheme((current) =>
                        current === "dark"
                          ? "light"
                          : "dark",
                      )
                    }
                  >
                    {theme === "dark" ? (
                      <>
                        <Sun size={14} />
                        Light
                      </>
                    ) : (
                      <>
                        <Moon size={14} />
                        Dark
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="modal-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  createConversation();
                }}
              >
                <label htmlFor="conversation-name">
                  {modal === "channel"
                    ? "Channel name"
                    : "GitHub username"}
                </label>

                <input
                  id="conversation-name"
                  autoFocus
                  value={newConversationName}
                  onChange={(event) =>
                    setNewConversationName(
                      event.target.value,
                    )
                  }
                  placeholder={
                    modal === "channel"
                      ? "e.g. architecture"
                      : "e.g. alice"
                  }
                />

                <div className="modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!newConversationName.trim()}
                  >
                    {modal === "channel"
                      ? "Create channel"
                      : "Start conversation"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;