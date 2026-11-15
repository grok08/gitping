import type { GitCommand } from "./parser";

export type CommandType = GitCommand["type"];

/**
 * What the server does with an accepted command. A content command produces a
 * message, a context command changes branch or stash state, and an unsupported
 * command is parsed so GitPing can name it, but has no handler yet.
 */
export type CommandSupport = "content" | "context" | "unsupported";

export type CommandArgKind =
  | "branch"
  | "messageId"
  | "text"
  | "stashId"
  | "remote";

export type CommandArg = {
  name: string;
  kind: CommandArgKind;
  required: boolean;
};

/**
 * One shape a command can take. `literals` are the fixed words between the
 * verb and the value, such as `-c` or `pop`. A form with `completeWithoutArg`
 * is already a valid command when its literals are present.
 */
export type CommandForm = {
  syntax: string;
  literals: readonly string[];
  arg?: CommandArg;
  completeWithoutArg: boolean;
};

export type CommandCatalogEntry = {
  name: string;
  types: readonly CommandType[];
  syntax: string;
  summary: string;
  example: string;
  support: CommandSupport;
  args: readonly CommandArg[];
  forms: readonly CommandForm[];
};

const commitMessage: CommandArg = {
  name: "message",
  kind: "text",
  required: true,
};

const stashNote: CommandArg = {
  name: "message",
  kind: "text",
  required: true,
};

const revertTarget: CommandArg = {
  name: "message-id",
  kind: "messageId",
  required: true,
};

const mergeBranch: CommandArg = {
  name: "branch",
  kind: "branch",
  required: true,
};

const branchName: CommandArg = {
  name: "name",
  kind: "branch",
  required: false,
};

const switchBranch: CommandArg = {
  name: "branch",
  kind: "branch",
  required: true,
};

const createBranch: CommandArg = {
  name: "branch",
  kind: "branch",
  required: true,
};

const stashTarget: CommandArg = {
  name: "stash",
  kind: "stashId",
  required: false,
};

const cloneRepository: CommandArg = {
  name: "repository",
  kind: "remote",
  required: true,
};

const showTarget: CommandArg = {
  name: "message-id",
  kind: "messageId",
  required: true,
};

const remoteName: CommandArg = {
  name: "remote",
  kind: "remote",
  required: false,
};

const configKey: CommandArg = {
  name: "key",
  kind: "text",
  required: true,
};

const configValue: CommandArg = {
  name: "value",
  kind: "text",
  required: true,
};

/**
 * The single source of command UX. The browser renders suggestions, hints,
 * previews, and help from this array, and the server builds its rejection
 * sentence from the same names, so the two cannot drift. The server still
 * owns dispatch: routing is a switch, not a table generated from here.
 *
 * Order matters twice: it is the order suggestions fall back to, and it is the
 * order the supported names appear in the rejection sentence.
 */
export const commandCatalog: readonly CommandCatalogEntry[] = [
  {
    name: "commit",
    types: ["commit"],
    syntax: 'git commit -m "<message>"',
    summary: "Send a message on the current branch.",
    example: 'git commit -m "Wire the command catalog"',
    support: "content",
    args: [commitMessage],
    forms: [
      {
        syntax: 'git commit -m "<message>"',
        literals: ["-m"],
        arg: commitMessage,
        completeWithoutArg: false,
      },
    ],
  },
  {
    name: "revert",
    types: ["revert"],
    syntax: "git revert <message-id>",
    summary: "Mark a message as reverted without deleting it.",
    example: "git revert 1a2b3c4d",
    support: "content",
    args: [revertTarget],
    forms: [
      {
        syntax: "git revert <message-id>",
        literals: [],
        arg: revertTarget,
        completeWithoutArg: false,
      },
    ],
  },
  {
    name: "merge",
    types: ["merge"],
    syntax: "git merge <branch>",
    summary: "Merge another branch into the current one.",
    example: "git merge weekend",
    support: "content",
    args: [mergeBranch],
    forms: [
      {
        syntax: "git merge <branch>",
        literals: [],
        arg: mergeBranch,
        completeWithoutArg: false,
      },
    ],
  },
  {
    name: "branch",
    types: ["branch"],
    syntax: "git branch [<name>]",
    summary: "List the conversation's branches, or create one.",
    example: "git branch weekend",
    support: "context",
    args: [branchName],
    forms: [
      {
        syntax: "git branch",
        literals: [],
        completeWithoutArg: true,
      },
      {
        syntax: "git branch <name>",
        literals: [],
        arg: { ...branchName, required: true },
        completeWithoutArg: false,
      },
    ],
  },
  {
    name: "switch",
    types: ["switch"],
    syntax: "git switch <branch>",
    summary: "Switch the conversation to another branch.",
    example: "git switch weekend",
    support: "context",
    args: [switchBranch],
    forms: [
      {
        syntax: "git switch <branch>",
        literals: [],
        arg: switchBranch,
        completeWithoutArg: false,
      },
      {
        syntax: "git switch -c <branch>",
        literals: ["-c"],
        arg: createBranch,
        completeWithoutArg: false,
      },
    ],
  },
  {
    name: "stash",
    types: ["stash-push", "stash-list", "stash-pop"],
    syntax: "git stash [push|list|pop]",
    summary: "Set the newest message aside, list stashes, or restore one.",
    example: "git stash pop",
    support: "context",
    args: [stashNote, stashTarget],
    forms: [
      {
        syntax: "git stash",
        literals: [],
        completeWithoutArg: true,
      },
      {
        syntax: 'git stash push -m "<message>"',
        literals: ["push", "-m"],
        arg: stashNote,
        completeWithoutArg: false,
      },
      {
        syntax: "git stash list",
        literals: ["list"],
        completeWithoutArg: true,
      },
      {
        syntax: "git stash pop [<stash>]",
        literals: ["pop"],
        arg: stashTarget,
        completeWithoutArg: true,
      },
    ],
  },
  {
    name: "init",
    types: ["init"],
    syntax: "git init",
    summary: "GitPing conversations are already initialised.",
    example: "git init",
    support: "unsupported",
    args: [],
    forms: [
      {
        syntax: "git init",
        literals: [],
        completeWithoutArg: true,
      },
    ],
  },
  {
    name: "clone",
    types: ["clone"],
    syntax: "git clone <repository>",
    summary: "Cloning a repository is not part of a conversation.",
    example: "git clone gitping://engineering",
    support: "unsupported",
    args: [cloneRepository],
    forms: [
      {
        syntax: "git clone <repository>",
        literals: [],
        arg: cloneRepository,
        completeWithoutArg: false,
      },
    ],
  },
  {
    name: "log",
    types: ["log"],
    syntax: "git log",
    summary: "Reading history is not enabled yet; the chat is the history.",
    example: "git log",
    support: "unsupported",
    args: [],
    forms: [
      {
        syntax: "git log",
        literals: [],
        completeWithoutArg: true,
      },
    ],
  },
  {
    name: "show",
    types: ["show"],
    syntax: "git show <message-id>",
    summary: "Showing one message is not enabled yet.",
    example: "git show 1a2b3c4d",
    support: "unsupported",
    args: [showTarget],
    forms: [
      {
        syntax: "git show <message-id>",
        literals: [],
        arg: showTarget,
        completeWithoutArg: false,
      },
    ],
  },
  {
    name: "status",
    types: ["status"],
    syntax: "git status",
    summary: "Working-tree status does not apply to a conversation.",
    example: "git status",
    support: "unsupported",
    args: [],
    forms: [
      {
        syntax: "git status",
        literals: [],
        completeWithoutArg: true,
      },
    ],
  },
  {
    name: "fetch",
    types: ["fetch"],
    syntax: "git fetch [<remote>]",
    summary: "Remotes are not connected yet.",
    example: "git fetch origin",
    support: "unsupported",
    args: [remoteName],
    forms: [
      {
        syntax: "git fetch [<remote>]",
        literals: [],
        arg: remoteName,
        completeWithoutArg: true,
      },
    ],
  },
  {
    name: "pull",
    types: ["pull"],
    syntax: "git pull [<remote> [<branch>]]",
    summary: "Remotes are not connected yet.",
    example: "git pull origin main",
    support: "unsupported",
    args: [remoteName, { name: "branch", kind: "branch", required: false }],
    forms: [
      {
        syntax: "git pull [<remote> [<branch>]]",
        literals: [],
        arg: remoteName,
        completeWithoutArg: true,
      },
    ],
  },
  {
    name: "push",
    types: ["push"],
    syntax: "git push [<remote> [<branch>]]",
    summary: "Remotes are not connected yet.",
    example: "git push origin main",
    support: "unsupported",
    args: [remoteName, { name: "branch", kind: "branch", required: false }],
    forms: [
      {
        syntax: "git push [<remote> [<branch>]]",
        literals: [],
        arg: remoteName,
        completeWithoutArg: true,
      },
    ],
  },
  {
    name: "config",
    types: ["config"],
    syntax: "git config <key> <value>",
    summary: "GitPing has no per-repository config yet.",
    example: 'git config user.name "Umesh Chandra"',
    support: "unsupported",
    args: [configKey, configValue],
    forms: [
      {
        syntax: "git config <key> <value>",
        literals: [],
        arg: configKey,
        completeWithoutArg: false,
      },
    ],
  },
];

const entriesByType = new Map<CommandType, CommandCatalogEntry>();

for (const entry of commandCatalog) {
  for (const type of entry.types) {
    entriesByType.set(type, entry);
  }
}

/**
 * The entry that owns a parser result. Total by construction: the catalog test
 * proves every parser type has exactly one entry.
 */
export function catalogEntryForType(type: CommandType): CommandCatalogEntry {
  const entry = entriesByType.get(type);

  if (!entry) {
    throw new Error(`No command catalog entry for type: ${type}`);
  }

  return entry;
}

export function catalogEntryForName(
  name: string,
): CommandCatalogEntry | undefined {
  return commandCatalog.find((entry) => entry.name === name);
}

/** Content and context commands are the ones GitPing can run today. */
export function supportedCommandEntries(): readonly CommandCatalogEntry[] {
  return commandCatalog.filter((entry) => entry.support !== "unsupported");
}

export function supportedCommandNames(): readonly string[] {
  return supportedCommandEntries().map((entry) => entry.name);
}

export function formatCommandList(names: readonly string[]): string {
  const [first, ...rest] = names;

  if (first === undefined) {
    return "";
  }

  if (rest.length === 0) {
    return first;
  }

  return `${[first, ...rest.slice(0, -1)].join(", ")}, or ${rest[rest.length - 1]}`;
}

/**
 * The sentence the server answers with when a parsed command has no handler.
 * It is built from the catalog so it names exactly the commands the browser
 * offers.
 */
export function unsupportedCommandMessage(): string {
  const names = supportedCommandNames().map((name) => `git ${name}`);

  return `Unsupported command. Use ${formatCommandList(names)}.`;
}
