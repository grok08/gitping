export type GitCommand =
  | {
      type: "init";
    }
  | {
      type: "clone";
      repository: string;
    }
  | {
      type: "commit";
      message: string;
      amend: boolean;
    }
  | {
      type: "log";
    }
  | {
      type: "show";
      target: string;
    }
  | {
      type: "branch";
      name?: string;
    }
  | {
      type: "switch";
      name: string;
      create: boolean;
    }
  | {
      type: "status";
    }
  | {
      type: "fetch";
      remote?: string;
    }
  | {
      type: "pull";
      remote?: string;
      branch?: string;
    }
  | {
      type: "push";
      remote?: string;
      branch?: string;
    }
  | {
      type: "revert";
      target: string;
    }
  | {
      type: "stash-push";
      message?: string;
    }
  | {
      type: "stash-list";
    }
  | {
      type: "stash-pop";
      stash?: string;
    }
  | {
      type: "config";
      key: string;
      value: string;
    };

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote !== null) {
    throw new Error("Unterminated quote");
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function requireArgument(
  tokens: string[],
  index: number,
  description: string,
): string {
  const value = tokens[index];

  if (value === undefined) {
    throw new Error(`Missing ${description}`);
  }

  return value;
}

export function parseCommand(input: string): GitCommand {
  const tokens = tokenize(input);

  if (tokens.length === 0 || tokens[0] !== "git") {
    throw new Error("Command must start with 'git'");
  }

  const command = tokens[1];

  if (command === undefined) {
    throw new Error("Missing Git command");
  }

  switch (command) {
    case "init": {
      if (tokens.length !== 2) {
        throw new Error("git init does not accept additional arguments");
      }

      return {
        type: "init",
      };
    }

    case "clone": {
      return {
        type: "clone",
        repository: requireArgument(tokens, 2, "repository"),
      };
    }

    case "commit": {
      let message: string | undefined;
      let amend = false;

      for (let i = 2; i < tokens.length; i++) {
        const token = tokens[i];

        if (token === undefined) {
          throw new Error("Invalid git commit syntax");
        }

        if (token === "--amend") {
          amend = true;
          continue;
        }

        if (token === "-m") {
          message = requireArgument(tokens, i + 1, "commit message");
          i++;
          continue;
        }

        if (token.startsWith("--message=")) {
          message = token.slice("--message=".length);
          continue;
        }

        throw new Error(`Unsupported git commit option: ${token}`);
      }

      if (message === undefined) {
        throw new Error("git commit requires -m <message>");
      }

      return {
        type: "commit",
        message,
        amend,
      };
    }

    case "log": {
      if (tokens.length !== 2) {
        throw new Error("Unsupported git log syntax");
      }

      return {
        type: "log",
      };
    }

    case "show": {
      return {
        type: "show",
        target: requireArgument(tokens, 2, "message ID"),
      };
    }

    case "branch": {
      if (tokens.length === 2) {
        return {
          type: "branch",
        };
      }

      if (tokens.length === 3) {
        const name = tokens[2];

        if (name === undefined || name.startsWith("-")) {
          throw new Error("Unsupported git branch syntax");
        }

        return {
          type: "branch",
          name,
        };
      }

      throw new Error("Unsupported git branch syntax");
    }

    case "switch": {
      if (tokens.length === 3) {
        return {
          type: "switch",
          name: requireArgument(tokens, 2, "branch name"),
          create: false,
        };
      }

      if (tokens.length === 4 && tokens[2] === "-c") {
        return {
          type: "switch",
          name: requireArgument(tokens, 3, "branch name"),
          create: true,
        };
      }

      throw new Error(
        "Use git switch <branch> or git switch -c <branch>",
      );
    }

    case "status": {
      if (tokens.length !== 2) {
        throw new Error("Unsupported git status syntax");
      }

      return {
        type: "status",
      };
    }

    case "fetch": {
      if (tokens.length > 3) {
        throw new Error("Unsupported git fetch syntax");
      }

      return {
        type: "fetch",
        remote: tokens[2],
      };
    }

    case "pull": {
      if (tokens.length > 4) {
        throw new Error("Unsupported git pull syntax");
      }

      return {
        type: "pull",
        remote: tokens[2],
        branch: tokens[3],
      };
    }

    case "push": {
      if (tokens.length > 4) {
        throw new Error("Unsupported git push syntax");
      }

      return {
        type: "push",
        remote: tokens[2],
        branch: tokens[3],
      };
    }

    case "revert": {
      return {
        type: "revert",
        target: requireArgument(tokens, 2, "message ID"),
      };
    }

    case "stash": {
      if (tokens.length === 2) {
        return {
          type: "stash-push",
        };
      }

      const subcommand = tokens[2];

      if (subcommand === "list" && tokens.length === 3) {
        return {
          type: "stash-list",
        };
      }

      if (subcommand === "pop") {
        if (tokens.length > 4) {
          throw new Error("Unsupported git stash pop syntax");
        }

        return {
          type: "stash-pop",
          stash: tokens[3],
        };
      }

      if (subcommand === "push") {
        let message: string | undefined;

        for (let i = 3; i < tokens.length; i++) {
          const token = tokens[i];

          if (token === undefined) {
            throw new Error("Invalid git stash syntax");
          }

          if (token === "-m") {
            message = requireArgument(tokens, i + 1, "stash message");
            i++;
            continue;
          }

          if (token.startsWith("--message=")) {
            message = token.slice("--message=".length);
            continue;
          }

          throw new Error(`Unsupported git stash option: ${token}`);
        }

        return {
          type: "stash-push",
          message,
        };
      }

      throw new Error("Unsupported git stash syntax");
    }

    case "config": {
      if (tokens.length !== 4) {
        throw new Error("Unsupported git config syntax");
      }

      return {
        type: "config",
        key: requireArgument(tokens, 2, "config key"),
        value: requireArgument(tokens, 3, "config value"),
      };
    }

    default:
      throw new Error(`Unsupported GitPing command: git ${command}`);
  }
}