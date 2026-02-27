import fs from "node:fs";
import path from "node:path";
import type { OpenColabConfig } from "../config.js";
import { getSetting, setSetting, type Db } from "../db.js";
import { upsertProject } from "../db.js";
import { recordEvent } from "../events.js";
import { ensureProjectLayout, ensureRunLayout } from "../paths.js";
import { appendRunEvent, writeError, writeMeetingSummary, writeOutput, writePrompt } from "../storage.js";
import type { AgentInstance, PlannedTask, RunStartInput, TaskStatus } from "../types.js";
import { newId, nowIso, toJson } from "../utils.js";
import { AgentRegistry } from "../agent-registry.js";
import { AgentRunner } from "../agent-runner.js";
import { TaskRouter } from "../router.js";
import { ChatService } from "../collaboration/chats.js";
import { MeetingService } from "../collaboration/meetings.js";
import { requestApproval, setApprovalStatus, pauseRun, stopRun, setRunStatus } from "../checkpoints.js";
import { RepositoryService } from "../repositories.js";
import { PaperService } from "../papers.js";
import { SkillRegistry } from "../skills/registry.js";
import { TelegramBridge } from "../telegram.js";

interface RunRow {
  run_id: string;
  project_name: string;
  goal: string;
  status: string;
  reviewer_summary: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  task_id: string;
  run_id: string;
  agent_id: string | null;
  title: string;
  prompt: string;
  status: TaskStatus;
  retries: number;
  started_at: string | null;
  finished_at: string | null;
  stdout_path: string | null;
  stderr_path: string | null;
  output_files: string;
  created_at: string;
  updated_at: string;
}

type TelegramCommand = "help" | "run" | "status" | "approve" | "pause" | "stop";

interface ParsedTelegramCommand {
  command: TelegramCommand;
  arg: string | null;
}

export class Orchestrator {
  private readonly registry: AgentRegistry;
  private readonly runner: AgentRunner;
  private readonly router: TaskRouter;
  private readonly chats: ChatService;
  private readonly meetings: MeetingService;
  private readonly repos: RepositoryService;
  private readonly papers: PaperService;
  private readonly skills: SkillRegistry;
  private readonly telegram: TelegramBridge;

  constructor(
    private readonly db: Db,
    private readonly config: OpenColabConfig
  ) {
    this.registry = new AgentRegistry(db, config);
    this.runner = new AgentRunner(config);
    this.router = new TaskRouter();
    this.chats = new ChatService(db);
    this.meetings = new MeetingService(db);
    this.repos = new RepositoryService(db, config);
    this.papers = new PaperService(db, config);
    this.skills = new SkillRegistry(db, config);
    this.telegram = new TelegramBridge(db, config);
  }

  init(): void {
    this.registry.ensureDefaults();
    this.skills.syncSkills();
  }

  createProject(projectName: string): void {
    upsertProject(this.db, projectName);
    ensureProjectLayout(this.config, projectName);
  }

  addAgentTemplate(input: {
    templateId: string;
    provider: "openai" | "anthropic" | "google";
    cliCommand: string;
    defaultArgs: string[];
    defaultEnv: Record<string, string>;
  }): void {
    this.registry.createTemplate(input);
  }

  addAgentInstance(input: {
    agentId: string;
    templateId: string;
    role: "professor" | "student" | "reviewer";
    workspacePath: string;
    maxRuntimeSec: number;
    retryLimit: number;
    isolationMode: "host" | "docker";
    enabled: boolean;
  }): string {
    return this.registry.createInstance(input);
  }

  listAgentInstances() {
    return this.registry.listInstances();
  }

  listAgentTemplates() {
    return this.registry.listTemplates();
  }

  getSetting(key: string): string | null {
    return getSetting(this.db, key);
  }

  setSetting(key: string, value: string): void {
    setSetting(this.db, key, value);
  }

  async startRun(input: RunStartInput): Promise<{ runId: string; status: string }> {
    const now = nowIso();
    const runId = newId("run");

    this.createProject(input.projectName);
    const runPaths = ensureRunLayout(this.config, input.projectName, runId);

    this.db.run(
      `INSERT INTO runs (run_id, project_name, goal, status, reviewer_summary, created_at, updated_at)
       VALUES (:run_id, :project_name, :goal, :status, :reviewer_summary, :created_at, :updated_at)`,
      {
        run_id: runId,
        project_name: input.projectName,
        goal: input.goal,
        status: "created",
        reviewer_summary: null,
        created_at: now,
        updated_at: now
      }
    );

    recordEvent(this.db, runId, "run.created", {
      projectName: input.projectName,
      goal: input.goal
    });

    appendRunEvent(runPaths, {
      eventType: "run.created",
      projectName: input.projectName,
      runId
    });

    const allAgents = this.registry.listInstances().filter((agent) => agent.enabled);
    const students = allAgents.filter((agent) => agent.role === "student");
    const professor = allAgents.find((agent) => agent.role === "professor");

    if (!professor) {
      throw new Error("No enabled professor agent configured");
    }

    if (students.length === 0) {
      throw new Error("No enabled student agents configured");
    }

    this.repos.ensureDefaultProjectRepos(
      input.projectName,
      students.map((student) => student.agentId)
    );

    const skillRows = this.skills.syncSkills();
    if (skillRows.length > 0) {
      for (const student of students) {
        this.skills.bindSkill(student.agentId, skillRows[0].skillName);
      }
    }

    const groupChatId = this.chats.createChat(
      runId,
      "group",
      "Team Discussion",
      ["human", ...allAgents.map((agent) => agent.agentId)]
    );

    const kickoffMeetingId = this.meetings.createMeeting(runId, "kickoff", "Kickoff Meeting");
    const midMeetingId = this.meetings.createMeeting(runId, "mid_run", "Mid-run Review");
    const finalMeetingId = this.meetings.createMeeting(runId, "final_synthesis", "Final Synthesis");

    const kickoffSummary = [
      "# Kickoff",
      "",
      `Goal: ${input.goal}`,
      `Professor: ${professor.agentId}`,
      `Students: ${students.map((student) => student.agentId).join(", ")}`
    ].join("\n");

    this.meetings.updateSummary(kickoffMeetingId, kickoffSummary);
    writeMeetingSummary(runPaths, kickoffMeetingId, kickoffSummary);

    this.chats.addMessage(
      groupChatId,
      professor.agentId,
      `Kickoff complete. Assigned ${students.length} students to parallel tracks.`
    );
    recordEvent(this.db, runId, "meeting.created", { meetingId: kickoffMeetingId, type: "kickoff" });

    setRunStatus(this.db, runId, "planning");
    recordEvent(this.db, runId, "plan.created", { planner: professor.agentId });

    const plan = this.planTasks(input.goal);
    const taskAssignments = plan.map((task) => {
      const assignee = this.router.pickStudentAgent(students);
      const taskId = newId("task");
      const createdAt = nowIso();

      this.db.run(
        `INSERT INTO tasks (
           task_id, run_id, agent_id, title, prompt, status, retries,
           started_at, finished_at, stdout_path, stderr_path, output_files,
           created_at, updated_at
         ) VALUES (
           :task_id, :run_id, :agent_id, :title, :prompt, :status, :retries,
           :started_at, :finished_at, :stdout_path, :stderr_path, :output_files,
           :created_at, :updated_at
         )`,
        {
          task_id: taskId,
          run_id: runId,
          agent_id: assignee.agentId,
          title: task.title,
          prompt: task.prompt,
          status: "queued",
          retries: 0,
          started_at: null,
          finished_at: null,
          stdout_path: null,
          stderr_path: null,
          output_files: "[]",
          created_at: createdAt,
          updated_at: createdAt
        }
      );

      recordEvent(this.db, runId, "task.created", {
        taskId,
        title: task.title,
        agentId: assignee.agentId
      });

      return {
        taskId,
        agent: assignee,
        task
      };
    });

    setRunStatus(this.db, runId, "running");

    const results = await mapWithConcurrency(
      taskAssignments,
      this.config.globalConcurrency,
      async (assignment) => {
        const template = this.registry.getTemplate(assignment.agent.templateId);
        if (!template) {
          throw new Error(`Template not found: ${assignment.agent.templateId}`);
        }

        const startedAt = nowIso();
        this.db.run(
          `UPDATE tasks
           SET status = :status,
               started_at = :started_at,
               updated_at = :updated_at
           WHERE task_id = :task_id`,
          {
            task_id: assignment.taskId,
            status: "running",
            started_at: startedAt,
            updated_at: startedAt
          }
        );

        recordEvent(this.db, runId, "task.started", {
          taskId: assignment.taskId,
          agentId: assignment.agent.agentId
        });

        const promptPath = writePrompt(runPaths, assignment.taskId, assignment.task.prompt);
        const output = await this.runner.runTask(
          {
            runId,
            taskId: assignment.taskId,
            prompt: assignment.task.prompt,
            workspacePath: assignment.agent.workspacePath,
            contextFiles: [promptPath]
          },
          template,
          assignment.agent
        );

        const stdoutPath = writeOutput(runPaths, assignment.taskId, output.stdout);
        const stderrPath = writeError(runPaths, assignment.taskId, output.stderr);

        const status: TaskStatus =
          output.status === "ok" ? "ok" : output.status === "timeout" ? "timeout" : "error";

        this.db.run(
          `UPDATE tasks
           SET status = :status,
               finished_at = :finished_at,
               stdout_path = :stdout_path,
               stderr_path = :stderr_path,
               output_files = :output_files,
               updated_at = :updated_at
           WHERE task_id = :task_id`,
          {
            task_id: assignment.taskId,
            status,
            finished_at: output.finishedAt,
            stdout_path: stdoutPath,
            stderr_path: stderrPath,
            output_files: toJson(output.outputFiles),
            updated_at: nowIso()
          }
        );

        if (status === "ok") {
          recordEvent(this.db, runId, "task.completed", {
            taskId: assignment.taskId,
            agentId: assignment.agent.agentId,
            stdoutPath,
            stderrPath
          });
        } else {
          recordEvent(this.db, runId, "task.failed", {
            taskId: assignment.taskId,
            agentId: assignment.agent.agentId,
            status,
            stderrPath
          });
        }

        this.chats.addMessage(
          groupChatId,
          assignment.agent.agentId,
          `Task ${assignment.taskId} (${assignment.task.title}) finished with status=${status}`,
          [stdoutPath, stderrPath]
        );

        appendRunEvent(runPaths, {
          eventType: "task.completed",
          taskId: assignment.taskId,
          agentId: assignment.agent.agentId,
          status
        });

        return {
          ...assignment,
          status,
          stdoutPath,
          stderrPath,
          output
        };
      }
    );

    setRunStatus(this.db, runId, "review");

    const reviewSummary = this.buildReviewSummary(results.map((result) => result.output.stdout));
    this.db.run(
      `UPDATE runs
       SET reviewer_summary = :reviewer_summary,
           updated_at = :updated_at
       WHERE run_id = :run_id`,
      {
        run_id: runId,
        reviewer_summary: reviewSummary,
        updated_at: nowIso()
      }
    );

    recordEvent(this.db, runId, "review.completed", {
      reviewer: professor.agentId
    });

    this.meetings.updateSummary(
      midMeetingId,
      `# Mid-run Review\n\nParallel tasks completed: ${results.length}\n\nKey note: continue with synthesis.`
    );
    writeMeetingSummary(runPaths, midMeetingId, "Mid-run review completed.");

    const draft = this.papers.ensureRunDraft(input.projectName, runId, input.goal);
    this.papers.appendSection(draft.paperId, "Results", reviewSummary);
    recordEvent(this.db, runId, "paper.updated", {
      paperId: draft.paperId,
      latexMainPath: draft.latexMainPath
    });

    const finalSummary = [
      "# Final Synthesis",
      "",
      reviewSummary,
      "",
      "Awaiting human approval for closure."
    ].join("\n");

    this.meetings.updateSummary(finalMeetingId, finalSummary);
    writeMeetingSummary(runPaths, finalMeetingId, finalSummary);

    requestApproval(this.db, runId, professor.agentId, "Review complete. Please approve or rerun.");

    await this.telegram.sendRunUpdate(
      runId,
      `OpenColab run ${runId} is ready for approval. Project=${input.projectName}`
    );

    return {
      runId,
      status: "waiting_approval"
    };
  }

  getRunStatus(runId: string): {
    run: RunRow;
    tasks: TaskRow[];
    approval: { status: string; note: string | null } | null;
  } {
    const run = this.db.get<RunRow>(
      `SELECT run_id, project_name, goal, status, reviewer_summary, created_at, updated_at
       FROM runs
       WHERE run_id = :run_id`,
      { run_id: runId }
    );

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const tasks = this.db.all<TaskRow>(
      `SELECT task_id, run_id, agent_id, title, prompt, status, retries,
              started_at, finished_at, stdout_path, stderr_path, output_files,
              created_at, updated_at
       FROM tasks
       WHERE run_id = :run_id
       ORDER BY created_at ASC`,
      { run_id: runId }
    );

    const approval = this.db.get<{ status: string; note: string | null }>(
      `SELECT status, note
       FROM approvals
       WHERE run_id = :run_id`,
      { run_id: runId }
    );

    return {
      run,
      tasks,
      approval: approval ?? null
    };
  }

  listRuns(projectName?: string): RunRow[] {
    return this.db.all<RunRow>(
      `SELECT run_id, project_name, goal, status, reviewer_summary, created_at, updated_at
       FROM runs
       WHERE (:project_name IS NULL OR project_name = :project_name)
       ORDER BY created_at DESC`,
      { project_name: projectName ?? null }
    );
  }

  approveRun(runId: string): void {
    setApprovalStatus(this.db, runId, "approved", "Approved by human");
  }

  pauseRun(runId: string): void {
    pauseRun(this.db, runId);
  }

  stopRun(runId: string): void {
    stopRun(this.db, runId);
  }

  listChats(runId: string) {
    return this.chats.listChats(runId);
  }

  viewChat(chatId: string) {
    return this.chats.viewChat(chatId);
  }

  listMeetings(runId: string) {
    return this.meetings.listMeetings(runId);
  }

  addChatMessage(chatId: string, sender: string, content: string): string {
    return this.chats.addMessage(chatId, sender, content);
  }

  recordTelegramInbound(runId: string, sender: string, text: string, chatId?: string): void {
    this.telegram.recordInbound(runId, sender, text, chatId);
    this.appendTelegramToGroupChat(runId, sender, text);
  }

  async handleTelegramWebhookMessage(
    chatId: string,
    sender: string,
    text: string
  ): Promise<{ ok: boolean; action: string; runId: string | null; response: string }> {
    const incomingText = text.trim();
    const normalizedSender = sender.trim() || "human";

    if (!incomingText) {
      return {
        ok: false,
        action: "ignored",
        runId: null,
        response: "Ignored empty Telegram message."
      };
    }

    if (!this.telegram.hasConfiguredChat()) {
      return {
        ok: false,
        action: "not_configured",
        runId: null,
        response: "Telegram chat is not configured. Run setup and configure TELEGRAM_CHAT_ID."
      };
    }

    if (!this.telegram.isAllowedChat(chatId)) {
      return {
        ok: false,
        action: "unauthorized_chat",
        runId: null,
        response: "Ignored Telegram message from unauthorized chat."
      };
    }

    const parsed = parseTelegramCommand(incomingText);
    if (!parsed) {
      const runId = this.telegram.getLatestRunForChat(chatId);
      if (!runId) {
        const response =
          "No active run is linked to this chat. Use /run <run_id> first, then send your message.";
        await this.telegram.sendMessage(chatId, response);
        return { ok: false, action: "no_active_run", runId: null, response };
      }

      if (!this.runExists(runId)) {
        const response = `Run not found: ${runId}. Link a valid run with /run <run_id>.`;
        await this.telegram.sendMessage(chatId, response);
        return { ok: false, action: "run_not_found", runId, response };
      }

      this.recordTelegramInbound(runId, normalizedSender, incomingText, chatId);
      const response = `Recorded message for ${runId}.`;
      await this.telegram.sendMessage(chatId, response, runId);
      return { ok: true, action: "message_recorded", runId, response };
    }

    if (parsed.command === "help") {
      const response = telegramHelpText();
      await this.telegram.sendMessage(chatId, response);
      return { ok: true, action: "help", runId: null, response };
    }

    if (parsed.command === "run") {
      if (!parsed.arg) {
        const activeRunId = this.telegram.getLatestRunForChat(chatId);
        const response = activeRunId
          ? `Active run: ${activeRunId}`
          : "No active run. Use /run <run_id>.";
        await this.telegram.sendMessage(chatId, response, activeRunId ?? undefined);
        return { ok: Boolean(activeRunId), action: "run_show", runId: activeRunId, response };
      }

      const runId = parsed.arg;
      if (!this.runExists(runId)) {
        const response = `Run not found: ${runId}`;
        await this.telegram.sendMessage(chatId, response);
        return { ok: false, action: "run_not_found", runId, response };
      }

      this.telegram.activateRun(runId, chatId);
      this.recordTelegramInbound(runId, normalizedSender, incomingText, chatId);
      const response = `Active run set to ${runId}.`;
      await this.telegram.sendMessage(chatId, response, runId);
      return { ok: true, action: "run_set", runId, response };
    }

    const runId = parsed.arg ?? this.telegram.getLatestRunForChat(chatId);
    if (!runId) {
      const response = "No active run. Use /run <run_id> first.";
      await this.telegram.sendMessage(chatId, response);
      return { ok: false, action: "no_active_run", runId: null, response };
    }

    if (!this.runExists(runId)) {
      const response = `Run not found: ${runId}`;
      await this.telegram.sendMessage(chatId, response);
      return { ok: false, action: "run_not_found", runId, response };
    }

    this.telegram.activateRun(runId, chatId);
    this.recordTelegramInbound(runId, normalizedSender, incomingText, chatId);

    if (parsed.command === "status") {
      const status = this.getRunStatus(runId);
      const tasksByStatus = summarizeTasks(status.tasks);
      const response = [
        `Run ${runId}`,
        `status: ${status.run.status}`,
        `approval: ${status.approval?.status ?? "none"}`,
        `tasks: ${status.tasks.length} (${tasksByStatus})`
      ].join("\n");
      await this.telegram.sendMessage(chatId, response, runId);
      return { ok: true, action: "status", runId, response };
    }

    if (parsed.command === "approve") {
      this.approveRun(runId);
      const response = `Approved run ${runId}.`;
      await this.telegram.sendMessage(chatId, response, runId);
      return { ok: true, action: "approve", runId, response };
    }

    if (parsed.command === "pause") {
      this.pauseRun(runId);
      const response = `Paused run ${runId}.`;
      await this.telegram.sendMessage(chatId, response, runId);
      return { ok: true, action: "pause", runId, response };
    }

    this.stopRun(runId);
    const response = `Stopped run ${runId}.`;
    await this.telegram.sendMessage(chatId, response, runId);
    return { ok: true, action: "stop", runId, response };
  }

  syncSkills(): Array<{ skillName: string; path: string; description: string | null }> {
    return this.skills.syncSkills();
  }

  private planTasks(goal: string): PlannedTask[] {
    const sharedPromptPrefix = [
      `Research goal: ${goal}`,
      "",
      "Follow the OpenColab workflow:",
      "- gather evidence",
      "- discuss disagreements explicitly",
      "- produce concise output with assumptions",
      "- link results to repository artifacts when relevant"
    ].join("\n");

    return [
      {
        title: "Paper Discovery and Summary",
        prompt: `${sharedPromptPrefix}\n\nTask: Search and summarize relevant AI research papers.`
      },
      {
        title: "Experiment and Reproducibility Plan",
        prompt: `${sharedPromptPrefix}\n\nTask: Design experiment plan for local/SSH/Colab execution and expected metrics.`
      },
      {
        title: "Implementation and Repo Strategy",
        prompt: `${sharedPromptPrefix}\n\nTask: Propose per-agent and shared repository workflow with branch strategy.`
      }
    ];
  }

  private buildReviewSummary(outputs: string[]): string {
    const combined = outputs
      .map((output, index) => `## Student Output ${index + 1}\n${output.trim() || "(empty output)"}`)
      .join("\n\n");

    return [
      "Professor synthesis:",
      "- Reviewed student outputs and consolidated key findings.",
      "- Identified conflicts requiring human approval before closure.",
      "",
      combined
    ].join("\n");
  }

  private runExists(runId: string): boolean {
    const row = this.db.get<{ run_id: string }>(
      `SELECT run_id
       FROM runs
       WHERE run_id = :run_id`,
      { run_id: runId }
    );
    return Boolean(row);
  }

  private appendTelegramToGroupChat(runId: string, sender: string, text: string): void {
    const groupChat = this.db.get<{ chat_id: string }>(
      `SELECT chat_id
       FROM chats
       WHERE run_id = :run_id AND kind = :kind
       ORDER BY created_at ASC
       LIMIT 1`,
      {
        run_id: runId,
        kind: "group"
      }
    );

    if (!groupChat) {
      return;
    }

    this.chats.addMessage(groupChat.chat_id, `telegram:${sender}`, text);
  }
}

function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [rawCommand = "", rawArg = ""] = trimmed.split(/\s+/, 2);
  const commandName = rawCommand.slice(1).toLowerCase().split("@")[0];
  const arg = rawArg.trim() || null;

  if (
    commandName === "help" ||
    commandName === "start" ||
    commandName === "run" ||
    commandName === "status" ||
    commandName === "approve" ||
    commandName === "pause" ||
    commandName === "stop"
  ) {
    return {
      command: commandName === "start" ? "help" : commandName,
      arg
    };
  }

  return null;
}

function summarizeTasks(tasks: TaskRow[]): string {
  if (tasks.length === 0) {
    return "none";
  }

  const counts = new Map<string, number>();
  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

function telegramHelpText(): string {
  return [
    "OpenColab Telegram commands:",
    "/run <run_id> - set active run",
    "/status [run_id] - show run status",
    "/approve [run_id] - approve run",
    "/pause [run_id] - pause run",
    "/stop [run_id] - stop run",
    "Send plain text to record a message for the active run."
  ].join("\n");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const promise = (async () => {
      const value = await mapper(item);
      results.push(value);
    })();

    executing.add(promise);

    promise.finally(() => {
      executing.delete(promise);
    }).catch(() => {
      // Errors are surfaced when awaiting Promise.all below.
    });

    if (executing.size >= Math.max(1, concurrency)) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}
