import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowRight,
  GitBranch,
  Hash,
  MessageSquare,
  Search,
  User,
  X,
} from "lucide-react";
import { useSearchRequest } from "../../hooks/useSearchRequest";
import { searchWorkspace } from "../../lib/api";
import {
  clampActiveIndex,
  flattenResults,
  highlightSegments,
  moveActiveIndex,
} from "../../lib/search";
import type { SearchHit } from "../../lib/search";
import type { WorkspaceSearchResults } from "../../types/search";

type SearchPaletteProps = {
  onClose: () => void;
  onOpenConversation: (id: string) => void;
  onOpenPerson: (handle: string) => void;
  onOpenBranch: (conversationId: string, branch: string) => void;
  onOpenMessage: (conversationId: string, messageId: string) => void;
};

function titleOf(hit: SearchHit): string {
  switch (hit.kind) {
    case "message":
      return hit.message.snippet;
    case "conversation":
      return hit.conversation.kind === "channel"
        ? `#${hit.conversation.name}`
        : hit.conversation.name;
    case "user":
      return hit.user.handle;
    case "branch":
      return hit.branch.name;
  }
}

function metaOf(hit: SearchHit): string {
  switch (hit.kind) {
    case "message":
      return `#${hit.message.conversation.name} · ${hit.message.branch.name} · ${hit.message.author}`;
    case "conversation":
      return hit.conversation.kind === "channel"
        ? `${hit.conversation.memberCount} members`
        : "Direct message";
    case "user":
      return hit.user.role === "owner" ? "Owner" : "Developer";
    case "branch":
      return `#${hit.branch.conversationName}${
        hit.branch.current ? " · current" : ""
      }`;
  }
}

function IconFor({ kind }: { kind: SearchHit["kind"] }) {
  if (kind === "conversation") {
    return <Hash size={15} />;
  }

  if (kind === "user") {
    return <User size={15} />;
  }

  if (kind === "branch") {
    return <GitBranch size={15} />;
  }

  return <MessageSquare size={15} />;
}

function groupsOf(results: WorkspaceSearchResults) {
  const toHits = {
    messages: results.groups.messages.map(
      (message): SearchHit => ({
        kind: "message",
        key: `message:${message.id}`,
        message,
      }),
    ),
    conversations: results.groups.conversations.map(
      (conversation): SearchHit => ({
        kind: "conversation",
        key: `conversation:${conversation.id}`,
        conversation,
      }),
    ),
    users: results.groups.users.map(
      (user): SearchHit => ({ kind: "user", key: `user:${user.id}`, user }),
    ),
    branches: results.groups.branches.map(
      (branch): SearchHit => ({
        kind: "branch",
        key: `branch:${branch.id}`,
        branch,
      }),
    ),
  };

  return [
    { title: "Messages", hits: toHits.messages },
    { title: "Conversations", hits: toHits.conversations },
    { title: "People", hits: toHits.users },
    { title: "Branches", hits: toHits.branches },
  ].filter((group) => group.hits.length > 0);
}

export function SearchPalette({
  onClose,
  onOpenPerson,
  onOpenBranch,
  onOpenConversation,
  onOpenMessage,
}: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const request = useSearchRequest(query, true, searchWorkspace);
  const results = request.results;
  const groups = useMemo(() => (results ? groupsOf(results) : []), [results]);
  const hits = useMemo(() => (results ? flattenResults(results) : []), [results]);
  const indexByKey = useMemo(
    () => new Map(hits.map((hit, index) => [hit.key, index])),
    [hits],
  );
  const terms = results?.query.terms ?? [];
  const active = clampActiveIndex(activeIndex, hits.length);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;

    inputRef.current?.focus();

    return () => {
      previous?.focus();
    };
  }, []);

  function open(hit: SearchHit) {
    if (hit.kind === "conversation") {
      onOpenConversation(hit.conversation.id);
      return;
    }

    if (hit.kind === "user") {
      onOpenPerson(hit.user.handle);
      return;
    }

    if (hit.kind === "branch") {
      onOpenBranch(hit.branch.conversationId, hit.branch.name);
      return;
    }

    onOpenMessage(hit.message.conversation.id, hit.message.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        moveActiveIndex(
          active,
          event.key === "ArrowDown" ? 1 : -1,
          hits.length,
        ),
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const hit = hits[active];

      if (hit) {
        open(hit);
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "Tab") {
      // The dialog has two focusable stops, so Tab stays inside it.
      event.preventDefault();
      (event.shiftKey ? closeRef.current : inputRef.current)?.focus();
    }
  }

  const filters = results
    ? Object.entries(results.query.filters).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      )
    : [];

  return (
    <div
      className="search-palette-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search workspace"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-palette-input">
          <Search size={16} />

          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="search-palette-results"
            aria-activedescendant={
              hits.length > 0 ? `search-palette-hit-${active}` : undefined
            }
            aria-autocomplete="list"
            placeholder="Search messages, conversations, people, branches"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />

          <kbd>Esc</kbd>

          <button
            ref={closeRef}
            className="search-palette-close"
            type="button"
            onClick={onClose}
            aria-label="Close search"
          >
            <X size={15} />
          </button>
        </div>

        {filters.length > 0 && (
          <div className="search-palette-chips">
            {filters.map(([name, value]) => (
              <span className="search-chip" key={name}>
                {name}:{value}
              </span>
            ))}
          </div>
        )}

        <div
          className="search-palette-results"
          id="search-palette-results"
          role="listbox"
          aria-label="Search results"
        >
          {request.status === "idle" && (
            <div className="search-palette-idle">
              <span>
                Search every conversation, or narrow it with <code>author:</code>{" "}
                <code>command:</code> <code>branch:</code> <code>after:</code>{" "}
                <code>before:</code>.
              </span>
              <span>Try "login author:rahul" or "deploy after:2026-10-01".</span>
            </div>
          )}

          {request.status === "loading" && (
            <div className="search-palette-status">Searching…</div>
          )}

          {request.status === "error" && (
            <div className="search-palette-error" role="alert">
              {request.error}
            </div>
          )}

          {request.status === "ready" && hits.length === 0 && (
            <div className="search-palette-status">
              No matches for "{results?.query.text}"
            </div>
          )}

          {groups.map((group) => (
            <div role="group" aria-label={group.title} key={group.title}>
              <div className="search-group-title">{group.title}</div>

              {group.hits.map((hit) => {
                const index = indexByKey.get(hit.key) ?? 0;

                return (
                  <div
                    key={hit.key}
                    id={`search-palette-hit-${index}`}
                    className="search-hit"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => open(hit)}
                  >
                    <span className="search-hit-icon">
                      <IconFor kind={hit.kind} />
                    </span>

                    <span className="search-hit-body">
                      <span className="search-hit-title">
                        {hit.kind === "message"
                          ? highlightSegments(hit.message.snippet, terms).map(
                              (segment, segmentIndex) =>
                                segment.match ? (
                                  <mark key={segmentIndex}>
                                    {segment.text}
                                  </mark>
                                ) : (
                                  <span key={segmentIndex}>
                                    {segment.text}
                                  </span>
                                ),
                            )
                          : titleOf(hit)}
                      </span>
                      <span className="search-hit-meta">{metaOf(hit)}</span>
                    </span>

                    {index === active && (
                      <span className="search-hit-enter" aria-hidden="true">
                        <ArrowRight size={14} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="search-palette-footer">
          <span>Arrow keys to move, Enter to open</span>
          <span>Searches every conversation</span>
        </div>
      </div>
    </div>
  );
}
