import type { GitCommand } from "@gitping/command-engine";

export type PreviewContext = {
  conversationName: string;
  conversationKind: "channel" | "direct";
  branch: string;
};

function conversationLabel(context: PreviewContext): string {
  return context.conversationKind === "channel"
    ? `#${context.conversationName}`
    : context.conversationName;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * A plain-language reading of what the command will do, shown next to the
 * composer. It describes the command, not the server's answer, so it never
 * claims success before the server has spoken.
 */
export function commandPreview(
  command: GitCommand,
  context: PreviewContext,
): string {
  switch (command.type) {
    case "commit": {
      return `Commit to ${conversationLabel(context)} on ${context.branch}`;
    }

    case "revert": {
      return `Revert ${shortId(command.target)}`;
    }

    case "merge": {
      return `Merge ${command.branch} into ${context.branch}`;
    }

    case "branch": {
      return command.name
        ? `Create branch ${command.name} from ${context.branch}`
        : `List the branches in ${conversationLabel(context)}`;
    }

    case "switch": {
      return command.create
        ? `Create ${command.name} from ${context.branch} and switch to it`
        : `Switch to ${command.name}`;
    }

    case "stash-push": {
      return `Stash the newest message on ${context.branch}`;
    }

    case "stash-list": {
      return `List stashed messages on ${context.branch}`;
    }

    case "stash-pop": {
      return command.stash
        ? `Restore stash ${shortId(command.stash)}`
        : `Restore the newest stash on ${context.branch}`;
    }

    default: {
      return "Not enabled yet";
    }
  }
}
