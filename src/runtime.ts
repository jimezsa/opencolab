import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { initWorkspace } from "./paths.js";
import { Orchestrator } from "./orchestration/orchestrator.js";

export function createRuntime(cwd = process.cwd()): {
  orchestrator: Orchestrator;
  close: () => void;
} {
  const config = loadConfig(cwd);
  initWorkspace(config);
  const db = openDb(config);
  const orchestrator = new Orchestrator(db, config);
  orchestrator.init();

  return {
    orchestrator,
    close: () => db.close()
  };
}
