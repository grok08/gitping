import type { ApiBranch } from "../types/conversation";

/**
 * The branch the member is on, as reported by the server. A response always
 * carries exactly one `current` branch, and `main` is the fallback for a
 * conversation the server has not marked yet, so a reload never has to guess.
 */
export function currentBranchName(branches: ApiBranch[]): string {
  return (
    branches.find((item) => item.current)?.name ??
    branches.find((item) => item.name === "main")?.name ??
    branches[0]?.name ??
    "main"
  );
}
