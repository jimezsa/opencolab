import path from "node:path";
import type { OpenColabConfig } from "./config.js";
import type { Db } from "./db.js";
import { ensureDir, projectPath } from "./paths.js";
import { newId, nowIso } from "./utils.js";

export class RepositoryService {
  constructor(
    private readonly db: Db,
    private readonly config: OpenColabConfig
  ) {}

  ensureDefaultProjectRepos(projectName: string, agentIds: string[]): void {
    const projectBase = projectPath(this.config, projectName);
    const sharedRepoPath = ensureDir(path.join(projectBase, "repos", "shared", "team-research"));

    this.registerRepository({
      projectName,
      ownerType: "shared",
      ownerId: null,
      repoName: "team-research",
      repoUrl: null,
      localPath: sharedRepoPath
    });

    for (const agentId of agentIds) {
      const agentRepoPath = ensureDir(path.join(projectBase, "repos", "agents", agentId, "agent-research"));
      this.registerRepository({
        projectName,
        ownerType: "agent",
        ownerId: agentId,
        repoName: "agent-research",
        repoUrl: null,
        localPath: agentRepoPath
      });
    }
  }

  registerRepository(input: {
    projectName: string;
    ownerType: "agent" | "shared";
    ownerId: string | null;
    repoName: string;
    repoUrl: string | null;
    localPath: string;
  }): string {
    const repositoryId = newId("repo");
    this.db.run(
      `INSERT INTO repositories (
         repository_id, project_name, owner_type, owner_id,
         repo_name, repo_url, local_path, created_at
       ) VALUES (
         :repository_id, :project_name, :owner_type, :owner_id,
         :repo_name, :repo_url, :local_path, :created_at
       )`,
      {
        repository_id: repositoryId,
        project_name: input.projectName,
        owner_type: input.ownerType,
        owner_id: input.ownerId,
        repo_name: input.repoName,
        repo_url: input.repoUrl,
        local_path: input.localPath,
        created_at: nowIso()
      }
    );

    return repositoryId;
  }
}
