import type { AgentInstance } from "./types.js";

export class TaskRouter {
  private index = 0;

  pickStudentAgent(students: AgentInstance[]): AgentInstance {
    if (students.length === 0) {
      throw new Error("No enabled student agents are available");
    }

    const chosen = students[this.index % students.length];
    this.index += 1;
    return chosen;
  }
}
