import type { ConversationRepository } from "../repositories/conversation-repository";
import type { SearchPage, SearchRepository } from "../repositories/search-repository";
import type { UserRepository } from "../repositories/user-repository";
import {
  parseSearchLimit,
  parseSearchQuery,
  searchCriteria,
} from "../search/query";
import { messageSnippet } from "../search/snippet";
import type {
  ConversationSearchResults,
  SearchBranchHit,
  SearchConversationHit,
  SearchMessageHit,
  SearchUserHit,
  WorkspaceSearchResults,
} from "../types/http";

export type SearchFailure = {
  ok: false;
  status: 400 | 404;
  error: string;
};

export type SearchResult<T> = { ok: true; value: T } | SearchFailure;

export type SearchServiceDependencies = {
  conversations: ConversationRepository;
  users: UserRepository;
  search: SearchRepository;
};

function reject(status: 400 | 404, error: string): SearchFailure {
  return { ok: false, status, error };
}

function emptyPage<T>(): SearchPage<T> {
  return { rows: [], total: 0 };
}

function withSnippet(
  hit: Omit<SearchMessageHit, "snippet">,
  terms: readonly string[],
): SearchMessageHit {
  return { ...hit, snippet: messageSnippet(hit.text, terms) };
}

export function createSearchService({
  conversations,
  users,
  search,
}: SearchServiceDependencies) {
  return {
    all(
      viewerHandle: string,
      rawQuery: string | undefined,
      rawLimit: string | undefined,
    ): SearchResult<WorkspaceSearchResults> {
      const parsed = parseSearchQuery(rawQuery);

      if (!parsed.ok) {
        return reject(400, parsed.error);
      }

      const limit = parseSearchLimit(rawLimit);

      if (!limit.ok) {
        return reject(400, limit.error);
      }

      const query = parsed.query;
      const viewerId = users.findByHandle(viewerHandle)?.id ?? "";

      // Names carry no filters, so a query made only of filters searches
      // messages and leaves the name groups empty instead of matching
      // everything.
      const conversationPage: SearchPage<SearchConversationHit> =
        query.terms.length > 0
          ? search.conversations(query.terms, limit.value)
          : emptyPage();
      const userPage: SearchPage<SearchUserHit> =
        query.terms.length > 0
          ? search.people(query.terms, limit.value)
          : emptyPage();
      const branchPage: SearchPage<SearchBranchHit> =
        query.terms.length > 0
          ? search.branches(query.terms, viewerId, limit.value)
          : emptyPage();
      const messagePage = search.messages(searchCriteria(query), limit.value);

      return {
        ok: true,
        value: {
          query,
          groups: {
            conversations: conversationPage.rows,
            users: userPage.rows,
            branches: branchPage.rows,
            messages: messagePage.rows.map((hit) =>
              withSnippet(hit, query.terms),
            ),
          },
          totals: {
            conversations: conversationPage.total,
            users: userPage.total,
            branches: branchPage.total,
            messages: messagePage.total,
          },
          truncated: {
            conversations:
              conversationPage.total > conversationPage.rows.length,
            users: userPage.total > userPage.rows.length,
            branches: branchPage.total > branchPage.rows.length,
            messages: messagePage.total > messagePage.rows.length,
          },
        },
      };
    },

    conversation(
      conversationId: string,
      rawQuery: string | undefined,
      rawLimit: string | undefined,
    ): SearchResult<ConversationSearchResults> {
      if (!conversations.findById(conversationId)) {
        return reject(404, `Unknown conversation: ${conversationId}`);
      }

      const parsed = parseSearchQuery(rawQuery);

      if (!parsed.ok) {
        return reject(400, parsed.error);
      }

      const limit = parseSearchLimit(rawLimit);

      if (!limit.ok) {
        return reject(400, limit.error);
      }

      const query = parsed.query;
      const page = search.messages(
        searchCriteria(query, { conversationId }),
        limit.value,
      );

      return {
        ok: true,
        value: {
          query,
          messages: page.rows.map((hit) => withSnippet(hit, query.terms)),
          total: page.total,
          truncated: page.total > page.rows.length,
        },
      };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
