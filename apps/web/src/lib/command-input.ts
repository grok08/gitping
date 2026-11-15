import {
  catalogEntryForName,
  commandCatalog,
  parseCommand,
  supportedCommandEntries,
} from "@gitping/command-engine";
import type {
  CommandCatalogEntry,
  CommandForm,
  GitCommand,
} from "@gitping/command-engine";
import { commandPreview } from "./command-preview";

export type SuggestionMessage = {
  id: string;
  text: string;
  stashed: boolean;
  reverted: boolean;
};

export type CommandContext = {
  conversationName: string;
  conversationKind: "channel" | "direct";
  branch: string;
  branches: readonly string[];
  messages: readonly SuggestionMessage[];
  /** Where the caret is; defaults to the end of the input. */
  caret?: number;
};

export type CommandSuggestion = {
  id: string;
  label: string;
  detail: string;
  kind: "command" | "literal" | "branch" | "message" | "stash";
  current: boolean;
  /** Replaces the input between `replaceStart` and `replaceEnd`. */
  insert: string;
  caretFromEnd: number;
  replaceStart: number;
  replaceEnd: number;
};

export type CommandAnalysis =
  | { state: "empty" }
  | {
      state: "command";
      prefix: string;
      tokenStart: number;
      tokenEnd: number;
    }
  | {
      state: "literal";
      entry: CommandCatalogEntry;
      form: CommandForm;
      literalIndex: number;
      prefix: string;
      tokenStart: number;
      tokenEnd: number;
    }
  | {
      state: "argument";
      entry: CommandCatalogEntry;
      form: CommandForm;
      prefix: string;
      tokenStart: number;
      tokenEnd: number;
    }
  | {
      state: "complete";
      entry: CommandCatalogEntry;
      form: CommandForm;
      command: GitCommand;
      arg: string | null;
      tokenStart: number;
      tokenEnd: number;
    }
  | {
      state: "invalid";
      entry: CommandCatalogEntry | null;
      message: string;
    };

export type CommandValidation = {
  state: "empty" | "incomplete" | "invalid" | "complete";
  hint: string;
  preview: string;
  message: string;
};

type Token = {
  text: string;
  start: number;
  end: number;
  /** True when the caret sits inside this token and `text` stops at it. */
  caretInside: boolean;
};

type Match = {
  form: CommandForm;
  stage: "complete" | "argument" | "literal";
  literalIndex: number;
  /** The literals fully matched before the current position. */
  consumed: number;
  prefix: string;
  tokenStart: number;
  tokenEnd: number;
  arg: string | null;
};

const maximumSuggestions = 6;

function clampCaret(input: string, caret: number): number {
  return Math.max(0, Math.min(caret, input.length));
}

function caretFor(input: string, context: CommandContext): number {
  return clampCaret(input, context.caret ?? input.length);
}

/**
 * Splits on whitespace while keeping each token's source span, so a completion
 * can replace the token the caret is in without touching the rest of the line.
 */
function scanTokens(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    while (index < input.length && /\s/.test(input.charAt(index))) {
      index += 1;
    }

    if (index >= input.length) {
      break;
    }

    const start = index;
    let text = "";
    let quote: '"' | "'" | null = null;

    while (index < input.length) {
      const char = input.charAt(index);

      if (quote !== null) {
        if (char === quote) {
          quote = null;
        } else {
          text += char;
        }

        index += 1;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        index += 1;
        continue;
      }

      if (/\s/.test(char)) {
        break;
      }

      text += char;
      index += 1;
    }

    tokens.push({ text, start, end: index, caretInside: false });
  }

  return tokens;
}

/**
 * The tokens the caret has reached. A token the caret sits inside keeps its
 * full span for replacement but exposes only the text before the caret, so
 * "git switch fe|ature" matches on "fe".
 */
function tokensBeforeCaret(input: string, caret: number): Token[] {
  const tokens = scanTokens(input);
  const reached: Token[] = [];

  for (const token of tokens) {
    if (token.start >= caret) {
      break;
    }

    if (caret < token.end) {
      const raw = input.slice(token.start, caret);
      const text = raw.replace(/^["']/, "");

      reached.push({
        text,
        start: token.start,
        end: token.end,
        caretInside: true,
      });
      break;
    }

    reached.push(token);
  }

  return reached;
}

function matchForm(
  form: CommandForm,
  rest: readonly Token[],
  caret: number,
  trailingSpace: boolean,
): Match | null {
  for (let index = 0; index < form.literals.length; index += 1) {
    const literal = form.literals[index] ?? "";
    const token = rest[index];

    if (!token) {
      return {
        form,
        stage: "literal",
        literalIndex: index,
        consumed: index,
        prefix: "",
        tokenStart: caret,
        tokenEnd: caret,
        arg: null,
      };
    }

    if (token.text === literal) {
      continue;
    }

    const isLast = index === rest.length - 1;

    if (isLast && literal.startsWith(token.text)) {
      return {
        form,
        stage: "literal",
        literalIndex: index,
        consumed: index,
        prefix: token.text,
        tokenStart: token.start,
        tokenEnd: token.end,
        arg: null,
      };
    }

    return null;
  }

  const argToken = rest[form.literals.length];
  const beyond = rest[form.literals.length + 1];

  if (beyond) {
    return null;
  }

  if (!argToken) {
    return form.completeWithoutArg && !(form.arg && trailingSpace)
      ? {
          form,
          stage: "complete",
          literalIndex: form.literals.length,
          consumed: form.literals.length,
          prefix: "",
          tokenStart: caret,
          tokenEnd: caret,
          arg: null,
        }
      : {
          form,
          stage: "argument",
          literalIndex: form.literals.length,
          consumed: form.literals.length,
          prefix: "",
          tokenStart: caret,
          tokenEnd: caret,
          arg: null,
        };
  }

  if (!form.arg) {
    return null;
  }

  return {
    form,
    stage: "complete",
    literalIndex: form.literals.length,
    consumed: form.literals.length,
    prefix: argToken.text,
    tokenStart: argToken.start,
    tokenEnd: argToken.end,
    arg: argToken.text,
  };
}

/**
 * When the caret follows whitespace the user has started a new word, so an
 * optional-argument form is read as waiting for that argument rather than as a
 * finished command. "git branch" lists; "git branch " asks for a name.
 */
function selectMatch(
  entry: CommandCatalogEntry,
  rest: readonly Token[],
  caret: number,
  trailingSpace: boolean,
): Match | null {
  const matches = entry.forms
    .map((form) => matchForm(form, rest, caret, trailingSpace))
    .filter((match): match is Match => match !== null);

  if (matches.length === 0) {
    return null;
  }

  const deepest = Math.max(...matches.map((match) => match.consumed));
  const pool = matches.filter((match) => match.consumed === deepest);

  if (trailingSpace) {
    return (
      pool.find((match) => match.stage === "argument") ??
      pool.find((match) => match.stage === "literal") ??
      pool.find((match) => match.stage === "complete" && match.arg !== null) ??
      pool[0] ??
      null
    );
  }

  const partialLiteral = pool.find(
    (match) => match.stage === "literal" && match.prefix.length > 0,
  );

  if (partialLiteral) {
    return partialLiteral;
  }

  return (
    pool.find((match) => match.stage === "complete" && match.arg !== null) ??
    pool.find((match) => match.stage === "complete") ??
    pool.find((match) => match.stage === "argument") ??
    pool[0] ??
    null
  );
}

function parserMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unsupported command";
}

export function analyzeCommandInput(
  input: string,
  caret = input.length,
): CommandAnalysis {
  if (input.trim() === "") {
    return { state: "empty" };
  }

  const position = clampCaret(input, caret);
  const tokens = tokensBeforeCaret(input, position);
  const [first, verb] = tokens;

  if (!first) {
    return { state: "command", prefix: "", tokenStart: position, tokenEnd: position };
  }

  if (first.text !== "git") {
    if ("git".startsWith(first.text)) {
      return {
        state: "command",
        prefix: first.text,
        tokenStart: first.start,
        tokenEnd: first.caretInside ? first.end : position,
      };
    }

    return {
      state: "invalid",
      entry: null,
      message: "Command must start with 'git'",
    };
  }

  if (!verb) {
    return { state: "command", prefix: "", tokenStart: position, tokenEnd: position };
  }

  if (verb.caretInside) {
    return {
      state: "command",
      prefix: verb.text,
      tokenStart: verb.start,
      tokenEnd: verb.end,
    };
  }

  const entry = catalogEntryForName(verb.text);

  if (!entry || entry.support === "unsupported") {
    const partial = supportedCommandEntries().some((candidate) =>
      candidate.name.startsWith(verb.text),
    );

    if (!entry && partial) {
      return {
        state: "command",
        prefix: verb.text,
        tokenStart: verb.start,
        tokenEnd: position,
      };
    }

    return {
      state: "invalid",
      entry: entry ?? null,
      message: entry
        ? `${entry.syntax} is not enabled yet.`
        : `Unsupported GitPing command: git ${verb.text}`,
    };
  }

  const trailingSpace =
    position > 0 && /\s/.test(input.charAt(position - 1));
  const match = selectMatch(entry, tokens.slice(2), position, trailingSpace);

  if (!match) {
    try {
      parseCommand(input);
    } catch (error) {
      return { state: "invalid", entry, message: parserMessage(error) };
    }

    return {
      state: "invalid",
      entry,
      message: `Unsupported ${entry.syntax} syntax`,
    };
  }

  if (match.stage === "literal") {
    return {
      state: "literal",
      entry,
      form: match.form,
      literalIndex: match.literalIndex,
      prefix: match.prefix,
      tokenStart: match.tokenStart,
      tokenEnd: match.tokenEnd,
    };
  }

  if (match.stage === "argument") {
    return {
      state: "argument",
      entry,
      form: match.form,
      prefix: match.prefix,
      tokenStart: match.tokenStart,
      tokenEnd: match.tokenEnd,
    };
  }

  try {
    // Parse up to the token the caret is in. Text after the caret is not part
    // of the command being edited, and Enter still sends whatever is in the
    // composer, so the server stays the authority on the whole line.
    const completeInput = input.slice(
      0,
      match.arg === null ? position : match.tokenEnd,
    );

    return {
      state: "complete",
      entry,
      form: match.form,
      command: parseCommand(completeInput),
      arg: match.arg,
      tokenStart: match.tokenStart,
      tokenEnd: match.tokenEnd,
    };
  } catch (error) {
    return { state: "invalid", entry, message: parserMessage(error) };
  }
}

function supportRank(entry: CommandCatalogEntry): number {
  return entry.support === "content" ? 0 : 1;
}

function catalogRank(entry: CommandCatalogEntry): number {
  return commandCatalog.findIndex((candidate) => candidate.name === entry.name);
}

function byPrefix<T>(
  items: readonly T[],
  value: (item: T) => string,
  prefix: string,
): T[] {
  const scored = items
    .map((item, index) => ({
      item,
      index,
      exact: value(item) === prefix,
      matches: prefix === "" || value(item).startsWith(prefix),
    }))
    .filter((entry) => entry.matches);

  scored.sort((left, right) => {
    if (left.exact !== right.exact) {
      return left.exact ? -1 : 1;
    }

    return left.index - right.index;
  });

  return scored.map((entry) => entry.item);
}

function commandSuggestions(
  prefix: string,
  tokenStart: number,
  tokenEnd: number,
): CommandSuggestion[] {
  const matches = supportedCommandEntries()
    .filter((entry) => entry.name.startsWith(prefix))
    .sort((left, right) => {
      const leftExact = left.name === prefix ? 0 : 1;
      const rightExact = right.name === prefix ? 0 : 1;

      return (
        leftExact - rightExact ||
        supportRank(left) - supportRank(right) ||
        catalogRank(left) - catalogRank(right)
      );
    })
    .slice(0, maximumSuggestions);

  return matches.map((entry) => ({
    id: `command:${entry.name}`,
    label: entry.syntax,
    detail: entry.summary,
    kind: "command",
    current: false,
    insert: entry.name === "commit" ? 'commit -m ""' : `${entry.name} `,
    caretFromEnd: entry.name === "commit" ? 1 : 0,
    replaceStart: tokenStart,
    replaceEnd: tokenEnd,
  }));
}

function literalSuggestions(
  entry: CommandCatalogEntry,
  literalIndex: number,
  prefix: string,
  tokenStart: number,
  tokenEnd: number,
): CommandSuggestion[] {
  return entry.forms.flatMap((candidate) => {
    const literal = candidate.literals[literalIndex];

    if (literal === undefined || !literal.startsWith(prefix)) {
      return [];
    }

    const remaining = candidate.literals.slice(literalIndex);
    const insert =
      candidate.arg?.kind === "text"
        ? `${remaining.join(" ")} ""`
        : `${remaining.join(" ")}${candidate.arg ? " " : ""}`;

    return [
      {
        id: `literal:${candidate.syntax}`,
        label: candidate.syntax,
        detail: entry.summary,
        kind: "literal" as const,
        current: false,
        insert,
        caretFromEnd: candidate.arg?.kind === "text" ? 1 : 0,
        replaceStart: tokenStart,
        replaceEnd: tokenEnd,
      },
    ];
  });
}

function formPrefix(entry: CommandCatalogEntry, form: CommandForm): string {
  return ["git", entry.name, ...form.literals].join(" ");
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function branchSuggestions(
  entry: CommandCatalogEntry,
  form: CommandForm,
  prefix: string,
  context: CommandContext,
  excludeCurrent: boolean,
  tokenStart: number,
  tokenEnd: number,
): CommandSuggestion[] {
  const names = context.branches.filter(
    (name) => !excludeCurrent || name !== context.branch,
  );
  const base = formPrefix(entry, form);

  return byPrefix(names, (name) => name, prefix).map((name) => ({
    id: `branch:${name}`,
    label: `${base} ${name}`,
    detail: name === context.branch ? "current branch" : "branch",
    kind: "branch",
    current: name === context.branch,
    insert: name,
    caretFromEnd: 0,
    replaceStart: tokenStart,
    replaceEnd: tokenEnd,
  }));
}

function messageSuggestions(
  entry: CommandCatalogEntry,
  form: CommandForm,
  prefix: string,
  context: CommandContext,
  stashedOnly: boolean,
  tokenStart: number,
  tokenEnd: number,
): CommandSuggestion[] {
  const candidates = context.messages
    .filter((message) => (stashedOnly ? message.stashed : !message.reverted))
    .slice()
    .reverse();
  const base = formPrefix(entry, form);

  return byPrefix(candidates, (message) => shortId(message.id), prefix).map(
    (message) => ({
      id: `message:${message.id}`,
      label: `${base} ${shortId(message.id)}`,
      detail: `"${message.text}"`,
      kind: stashedOnly ? "stash" : "message",
      current: false,
      insert: shortId(message.id),
      caretFromEnd: 0,
      replaceStart: tokenStart,
      replaceEnd: tokenEnd,
    }),
  );
}

function argumentSuggestions(
  entry: CommandCatalogEntry,
  form: CommandForm,
  prefix: string,
  context: CommandContext,
  tokenStart: number,
  tokenEnd: number,
): CommandSuggestion[] {
  switch (entry.name) {
    case "commit": {
      if (prefix !== "") {
        return [];
      }

      return [
        {
          id: "literal:commit-message",
          label: form.syntax,
          detail: "message text",
          kind: "literal",
          current: false,
          insert: '""',
          caretFromEnd: 1,
          replaceStart: tokenStart,
          replaceEnd: tokenEnd,
        },
      ];
    }

    case "switch": {
      if (form.literals.includes("-c")) {
        return [];
      }

      return branchSuggestions(
        entry,
        form,
        prefix,
        context,
        false,
        tokenStart,
        tokenEnd,
      );
    }

    case "branch": {
      return [];
    }

    case "merge": {
      return branchSuggestions(
        entry,
        form,
        prefix,
        context,
        true,
        tokenStart,
        tokenEnd,
      );
    }

    case "revert": {
      return messageSuggestions(
        entry,
        form,
        prefix,
        context,
        false,
        tokenStart,
        tokenEnd,
      );
    }

    case "stash": {
      if (!form.literals.includes("pop")) {
        return [];
      }

      return messageSuggestions(
        entry,
        form,
        prefix,
        context,
        true,
        tokenStart,
        tokenEnd,
      );
    }

    default: {
      return [];
    }
  }
}

/**
 * Up to six completions for the text before the caret. Suggestions are pure:
 * the caller decides whether to show them, highlight one, or accept it.
 */
export function suggestCommands(
  input: string,
  context: CommandContext,
): CommandSuggestion[] {
  const analysis = analyzeCommandInput(input, caretFor(input, context));

  if (analysis.state === "empty" || analysis.state === "invalid") {
    return [];
  }

  if (analysis.state === "command") {
    return commandSuggestions(
      analysis.prefix,
      analysis.tokenStart,
      analysis.tokenEnd,
    );
  }

  if (analysis.state === "literal") {
    return literalSuggestions(
      analysis.entry,
      analysis.literalIndex,
      analysis.prefix,
      analysis.tokenStart,
      analysis.tokenEnd,
    ).slice(0, maximumSuggestions);
  }

  if (analysis.state === "argument") {
    return argumentSuggestions(
      analysis.entry,
      analysis.form,
      analysis.prefix,
      context,
      analysis.tokenStart,
      analysis.tokenEnd,
    ).slice(0, maximumSuggestions);
  }

  // A syntactically complete command can still be mid-argument, as in
  // "git switch fe". The parser accepts any name; only the server knows which
  // ones exist, so the known names stay on offer without blocking Enter.
  if (analysis.state === "complete" && analysis.arg !== null) {
    return argumentSuggestions(
      analysis.entry,
      analysis.form,
      analysis.arg,
      context,
      analysis.tokenStart,
      analysis.tokenEnd,
    ).slice(0, maximumSuggestions);
  }

  return [];
}

/**
 * Applies a suggestion at its recorded span. Text after the token survives, and
 * an insertion that lands next to existing whitespace does not double it.
 */
export function completeCommand(
  input: string,
  suggestion: CommandSuggestion,
): { value: string; caret: number } {
  const before = input.slice(0, suggestion.replaceStart);
  const after = input.slice(suggestion.replaceEnd);
  let insertion = suggestion.insert;

  if (
    suggestion.replaceStart === suggestion.replaceEnd &&
    before.length > 0 &&
    !/\s$/.test(before) &&
    !/^\s/.test(insertion)
  ) {
    insertion = ` ${insertion}`;
  }

  if (/^\s/.test(after) && /\s$/.test(insertion)) {
    insertion = insertion.trimEnd();
  }

  return {
    value: `${before}${insertion}${after}`,
    caret: before.length + insertion.length - suggestion.caretFromEnd,
  };
}

function branchHint(context: CommandContext, excludeCurrent: boolean): string {
  const names = context.branches.filter(
    (name) => !excludeCurrent || name !== context.branch,
  );

  return names.length > 0 ? `branch: ${names.join(", ")}` : "branch name";
}

function argumentHint(
  entry: CommandCatalogEntry,
  form: CommandForm,
  context: CommandContext,
): string {
  switch (entry.name) {
    case "commit": {
      return "message text";
    }

    case "switch": {
      return form.literals.includes("-c")
        ? "new branch name"
        : branchHint(context, false);
    }

    case "branch": {
      return "new branch name";
    }

    case "merge": {
      return branchHint(context, true);
    }

    case "revert": {
      return "message id";
    }

    case "stash": {
      return form.literals.includes("pop")
        ? "stashed message id"
        : "push, list, or pop";
    }

    default: {
      return "";
    }
  }
}

function describe(
  entry: CommandCatalogEntry,
  form: CommandForm,
): string {
  return `${form.syntax} · ${entry.summary}`;
}

/**
 * One reading of the composer text for the hint line, the preview, and the
 * inline error. Empty means idle, so an untouched composer renders nothing.
 */
export function validateCommand(
  input: string,
  context: CommandContext,
): CommandValidation {
  const analysis = analyzeCommandInput(input, caretFor(input, context));

  if (analysis.state === "empty") {
    return { state: "empty", hint: "", preview: "", message: "" };
  }

  if (analysis.state === "command") {
    const matching = supportedCommandEntries()
      .filter((entry) => entry.name.startsWith(analysis.prefix))
      .map((entry) => `git ${entry.name}`);

    return {
      state: "incomplete",
      hint:
        matching.length > 0 && analysis.prefix !== ""
          ? `Commands: ${matching.join(", ")}`
          : "Type a Git command",
      preview: "",
      message: "",
    };
  }

  if (analysis.state === "invalid") {
    const unsupported = analysis.entry?.support === "unsupported";

    return {
      state: "invalid",
      hint: analysis.entry
        ? `${analysis.entry.syntax} · ${analysis.entry.summary}`
        : "",
      preview: unsupported ? "Not enabled yet" : "",
      message: analysis.message,
    };
  }

  if (analysis.state === "literal") {
    return {
      state: "incomplete",
      hint: describe(analysis.entry, analysis.form),
      preview: "",
      message: "",
    };
  }

  if (analysis.state === "argument") {
    return {
      state: "incomplete",
      hint: `${analysis.form.syntax} · ${argumentHint(
        analysis.entry,
        analysis.form,
        context,
      )} · ${analysis.entry.summary}`,
      preview: "",
      message: "",
    };
  }

  return {
    state: "complete",
    hint: describe(analysis.entry, analysis.form),
    preview: commandPreview(analysis.command, {
      conversationName: context.conversationName,
      conversationKind: context.conversationKind,
      branch: context.branch,
    }),
    message: "",
  };
}
