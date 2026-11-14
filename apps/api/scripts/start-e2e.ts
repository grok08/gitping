import { rmSync } from "node:fs";

if (process.env.GITPING_DB_PATH) {
  rmSync(process.env.GITPING_DB_PATH, { force: true });
}

await import("../src/index");
