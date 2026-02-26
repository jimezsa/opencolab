import fs from "node:fs";
import path from "node:path";
import type { OpenColabConfig } from "../config.js";
import type { Db } from "../db.js";
import { nowIso } from "../utils.js";

export class SkillRegistry {
  constructor(
    private readonly db: Db,
    private readonly config: OpenColabConfig
  ) {}

  syncSkills(): Array<{ skillName: string; path: string; description: string | null }> {
    const out: Array<{ skillName: string; path: string; description: string | null }> = [];

    if (!fs.existsSync(this.config.skillsDir)) {
      return out;
    }

    for (const name of fs.readdirSync(this.config.skillsDir)) {
      const skillPath = path.join(this.config.skillsDir, name);
      const stat = fs.statSync(skillPath);
      if (!stat.isDirectory()) {
        continue;
      }

      const skillMd = path.join(skillPath, "SKILL.md");
      if (!fs.existsSync(skillMd)) {
        continue;
      }

      const content = fs.readFileSync(skillMd, "utf8");
      const description = extractDescription(content);
      this.db.run(
        `INSERT INTO skills (skill_name, path, description, synced_at)
         VALUES (:skill_name, :path, :description, :synced_at)
         ON CONFLICT(skill_name) DO UPDATE SET
           path = excluded.path,
           description = excluded.description,
           synced_at = excluded.synced_at`,
        {
          skill_name: name,
          path: skillPath,
          description,
          synced_at: nowIso()
        }
      );

      out.push({ skillName: name, path: skillPath, description });
    }

    return out;
  }

  bindSkill(agentId: string, skillName: string): void {
    this.db.run(
      `INSERT INTO agent_skill_bindings (binding_id, agent_id, skill_name, created_at)
       VALUES (:binding_id, :agent_id, :skill_name, :created_at)
       ON CONFLICT(agent_id, skill_name) DO NOTHING`,
      {
        binding_id: `${agentId}:${skillName}`,
        agent_id: agentId,
        skill_name: skillName,
        created_at: nowIso()
      }
    );
  }

  listSkillsForAgent(agentId: string): string[] {
    return this.db
      .all<{ skill_name: string }>(
        `SELECT skill_name
         FROM agent_skill_bindings
         WHERE agent_id = :agent_id
         ORDER BY skill_name`,
        { agent_id: agentId }
      )
      .map((row) => row.skill_name);
  }
}

function extractDescription(content: string): string | null {
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!yamlMatch) {
    return null;
  }

  const descMatch = yamlMatch[1].match(/^description:\s*(.+)$/m);
  return descMatch ? descMatch[1].trim() : null;
}
