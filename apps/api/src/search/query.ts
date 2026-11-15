import {
  formatCommandList,
  supportedCommandNames,
} from "@gitping/command-engine";
import type { ParsedSearchQuery, SearchFilters } from "../types/http";

export const maxSearchLength = 200;
export const defaultSearchLimit = 10;
export const maxSearchLimit = 50;

const filterNames = [
  "author",
  "command",
  "branch",
  "after",
  "before",
] as const;

type FilterName = (typeof filterNames)[number];

/**
 * A query becomes three lists: text terms combined with AND, the filters the
 * caller named, and the sentence to show when the query is unusable. Terms are
 * matched as substrings, so `ogi` finds `login`, and a quoted phrase stays one
 * term instead of splitting on its spaces.
 */
export type SearchQueryResult =
  | { ok: true; query: ParsedSearchQuery }
  | { ok: false; error: string };

export type SearchLimitResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

function isFilterName(value: string): value is FilterName {
  return (filterNames as readonly string[]).includes(value);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;

  for (const character of input) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && /\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function dayBoundary(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}([T ].+)?$/.test(value)) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function emptyFilters(): SearchFilters {
  return {
    author: null,
    command: null,
    branch: null,
    after: null,
    before: null,
  };
}

export function parseSearchQuery(raw: string | undefined): SearchQueryResult {
  const input = (raw ?? "").trim();

  if (!input) {
    return { ok: false, error: "Search query is required" };
  }

  if (input.length > maxSearchLength) {
    return {
      ok: false,
      error: `Search query is too long (${maxSearchLength} characters maximum)`,
    };
  }

  const filters = emptyFilters();
  const terms: string[] = [];

  for (const token of tokenize(input)) {
    const separator = token.indexOf(":");
    const name = separator > 0 ? token.slice(0, separator).toLowerCase() : "";

    // A word with an unknown prefix is text, so `note:` and `http://x` keep
    // working as search terms instead of being rejected.
    if (!isFilterName(name)) {
      terms.push(token);
      continue;
    }

    const value = token.slice(separator + 1).trim();

    if (!value) {
      return { ok: false, error: `${name}: needs a value` };
    }

    if (name === "after" || name === "before") {
      if (!dayBoundary(value)) {
        return {
          ok: false,
          error: `${name}: expects YYYY-MM-DD or an ISO timestamp`,
        };
      }

      filters[name] = value;
      continue;
    }

    if (name === "command") {
      const verb = value.toLowerCase().replace(/^git\s+/, "");

      if (!supportedCommandNames().includes(verb)) {
        return {
          ok: false,
          error: `Unknown command: ${value}. Supported: ${formatCommandList(
            supportedCommandNames(),
          )}.`,
        };
      }

      filters.command = verb;
      continue;
    }

    filters[name] = value;
  }

  if (terms.length === 0 && Object.values(filters).every((value) => value === null)) {
    return { ok: false, error: "Search query is required" };
  }

  return {
    ok: true,
    query: {
      text: terms.join(" "),
      terms,
      filters,
    },
  };
}

export function parseSearchLimit(raw: string | undefined): SearchLimitResult {
  if (raw === undefined || raw === "") {
    return { ok: true, value: defaultSearchLimit };
  }

  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      error: `limit must be a whole number from 1 to ${maxSearchLimit}`,
    };
  }

  const value = Number(raw);

  if (value < 1 || value > maxSearchLimit) {
    return {
      ok: false,
      error: `limit must be a whole number from 1 to ${maxSearchLimit}`,
    };
  }

  return { ok: true, value };
}

/**
 * The filters carry the value the caller typed, which is what the response
 * echoes back. The repository needs a comparable timestamp, so the conversion
 * from a date to a string bound happens once, here.
 */
export type SearchCriteria = {
  terms: readonly string[];
  conversationId: string | null;
  author: string | null;
  command: string | null;
  branch: string | null;
  after: string | null;
  before: string | null;
};

export function searchCriteria(
  query: ParsedSearchQuery,
  overrides: { conversationId?: string | null } = {},
): SearchCriteria {
  return {
    terms: query.terms,
    conversationId: overrides.conversationId ?? null,
    author: query.filters.author,
    command: query.filters.command,
    branch: query.filters.branch,
    after: query.filters.after ? dayBoundary(query.filters.after) : null,
    before: query.filters.before ? dayBoundary(query.filters.before) : null,
  };
}
