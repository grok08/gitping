# Shared Packages

This directory contains reusable packages in the GitPing Bun workspace. The root workspace configuration and root `bun.lock` manage dependencies for the apps and packages together.

## `@gitping/command-engine`

`command-engine` parses Git command strings into typed command values. It exports `parseCommand` and the `GitCommand` type, and is used by the API to validate incoming commands.

The parser currently recognizes commands including `init`, `clone`, `commit`, `log`, `show`, `branch`, `switch`, `status`, `fetch`, `pull`, `push`, `revert`, `stash`, and `config`. Unsupported syntax throws an error. The API's current message-creation flow persists only `git commit -m "message"`; parser support for other commands does not mean they are implemented as message actions yet.

## Tests

Run the command-engine tests from the repository root:

```bash
bun --filter @gitping/command-engine test
```

The package entry point is `packages/command-engine/src/index.ts`, and its parser tests are in `packages/command-engine/src/parser.test.ts`.
