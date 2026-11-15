import {
  commandCatalog,
  formatCommandList,
  supportedCommandEntries,
} from "@gitping/command-engine";

const unsupported = commandCatalog
  .filter((entry) => entry.support === "unsupported")
  .map((entry) => `git ${entry.name}`);

export function CommandHelp() {
  return (
    <div className="command-help">
      <p className="command-help-intro">
        Send a Git command from the composer. Every command acts on this
        conversation and the current branch.
      </p>

      <ul className="command-help-list">
        {supportedCommandEntries().map((entry) => (
          <li className="command-help-item" key={entry.name}>
            <code className="command-help-syntax">{entry.syntax}</code>
            <p className="command-help-summary">{entry.summary}</p>
            <code className="command-help-example">{entry.example}</code>
          </li>
        ))}
      </ul>

      <p className="command-help-note">
        {formatCommandList(unsupported)} are parsed but not enabled yet.
      </p>
    </div>
  );
}
