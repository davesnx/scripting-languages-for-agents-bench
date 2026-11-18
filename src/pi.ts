// Runs one agent session with pi (https://pi.dev) instead of the built-in loop.
//
// pi runs on the host in JSON mode, with no built-in tools, skills, context
// files, MCP, or user extensions. Its only extension is pi/extension.ts, which
// registers the tools of the condition and runs them in the task container.
// pi's own system prompt stays; the condition section and reference document
// of src/conditions.ts are appended to it.
//
// This module reads the JSON event stream and builds the same AgentOutput as
// loopAgent, so the runner, the judge, and the report do not change.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentOutput, CallLog, Message, TurnLog } from "./agent.ts";
import { clankBlocked } from "./conditions.ts";
import type { Condition, ModelConfig, StopReason, ToolOutcome, Usage } from "./types.ts";

const ROOT = join(import.meta.dirname, "..");
const EXTENSION = join(ROOT, "pi", "extension.ts");

export type PiSettings = {
  /** pi executable; default "pi" on PATH. */
  command?: string;
  /** --thinking level for every run; default "off", like the loop agent. */
  thinking?: string;
  /** Replace pi's system prompt with the benchmark's, instead of appending to it. Default false. */
  replaceSystemPrompt?: boolean;
  /** See Config.pi.clankMcp. */
  clankMcp?: "wrapped" | "native";
};

export type PiInput = {
  container: string;
  /** The task id and the image, for the code-mode conditions (src/codemode.ts). */
  task: string;
  image: string;
  condition: Condition;
  model: ModelConfig;
  /** tasks/<id>/mock.json, for the mock model. */
  mockFile: string;
  system: string;
  instruction: string;
  maxTurns: number;
  deadline: number;
  toolTimeoutSeconds: number;
  maxOutputChars: number;
  settings: PiSettings;
  overBudget(): boolean;
  spend(usage: Usage): void;
};

type PiUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
type PiContent = { type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> };
type PiMessage = { role: string; content: string | PiContent[]; usage?: PiUsage; stopReason?: string; errorMessage?: string; toolCallId?: string; timestamp?: number };
type PiEvent = {
  type: string;
  message?: PiMessage;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: { content?: PiContent[]; details?: { ok?: boolean; blocked?: ToolOutcome["blocked"] } };
  isError?: boolean;
  durationMs?: number;
};

const usageOf = (u: PiUsage | undefined): Usage => ({ inputTokens: u?.input ?? 0, cacheReadTokens: u?.cacheRead ?? 0, cacheWriteTokens: u?.cacheWrite ?? 0, outputTokens: u?.output ?? 0 });
const textOf = (content: string | PiContent[] | undefined) => (typeof content === "string" ? content : (content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""));

/** The provider and model arguments of pi for a model of config.json. */
function modelArgs(model: ModelConfig): string[] {
  if (model.provider === "mock") return ["--provider", "asl-mock", "--model", "mock"];
  return ["--provider", model.provider, "--model", model.id];
}

/** Converts pi messages to the message shape of the loop agent, for the transcript. */
function toMessage(m: PiMessage): Message | null {
  if (m.role === "user") return { role: "user", content: textOf(m.content) };
  if (m.role === "toolResult") return { role: "tool", tool_call_id: m.toolCallId ?? "", content: textOf(m.content) };
  if (m.role !== "assistant") return null;
  const calls = (Array.isArray(m.content) ? m.content : []).filter((c) => c.type === "toolCall");
  return {
    role: "assistant",
    content: textOf(m.content) || null,
    ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id ?? "", type: "function" as const, function: { name: c.name ?? "", arguments: JSON.stringify(c.arguments ?? {}) } })) } : {}),
  };
}

/** The pi command line and environment for one session, in a new temporary home. */
function piCommand(input: PiInput, home: string): { args: string[]; env: Record<string, string>; cwd: string } {
  // An empty config directory: no user settings, packages, or credentials files.
  // Credentials come from the provider's environment variable.
  const agentDir = join(home, "agent");
  const cwd = join(home, "cwd");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true }));
  const promptFile = join(home, "system-prompt.md");
  writeFileSync(promptFile, input.system);
  const native = input.condition === "clank" && input.settings.clankMcp === "native";
  const args = [
    "--mode", "json", "--no-session",
    "--no-builtin-tools", "--no-extensions", ...(native ? ["--extension", "builtin:mcp"] : ["--no-mcp"]), "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes", "--no-approve",
    "--extension", EXTENSION,
    input.settings.replaceSystemPrompt ? "--system-prompt" : "--append-system-prompt", promptFile,
    "--thinking", input.settings.thinking ?? "off",
    ...modelArgs(input.model),
    input.instruction,
  ];
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    ASL_CONTAINER: input.container,
    ASL_CONDITION: input.condition,
    ASL_TASK: input.task,
    ASL_IMAGE: input.image,
    ASL_TOOL_TIMEOUT: String(input.toolTimeoutSeconds),
    ASL_MAX_OUTPUT: String(input.maxOutputChars),
    ASL_MAX_TURNS: String(input.maxTurns),
    ASL_DEADLINE: String(input.deadline),
  };
  if (input.model.provider === "mock") env.ASL_MOCK_FILE = input.mockFile;
  if (native) env.ASL_CLANK_MCP = "native";
  return { args, env, cwd };
}

const isEmptyAbort = (m: PiMessage) =>
  m.stopReason === "aborted" && (Array.isArray(m.content) ? m.content.length === 0 : !m.content) && !usageOf(m.usage).outputTokens;

/** Folds pi's JSON events into the messages and turn logs of the loop agent. */
class EventLog {
  readonly messages: Message[];
  readonly turns: TurnLog[] = [];
  lastAssistant: PiMessage | null = null;
  private turn: TurnLog | null = null;
  private modelStarted = 0;
  // tool_execution_end has no args; keep them from tool_execution_start.
  private argsById = new Map<string, Record<string, unknown>>();

  private readonly onUsage: (usage: Usage) => void;

  constructor(system: string, onUsage: (usage: Usage) => void) {
    this.messages = [{ role: "system", content: system }];
    this.onUsage = onUsage;
  }

  add(e: PiEvent): void {
    if (e.type === "message_start" && e.message?.role === "assistant") this.startReply();
    else if (e.type === "message_end" && e.message) this.endMessage(e.message);
    else if (e.type === "tool_execution_start") this.argsById.set(e.toolCallId ?? "", e.args ?? {});
    else if (e.type === "tool_execution_end") this.endTool(e);
  }

  // A turn starts with an assistant reply, not with turn_start: after the
  // extension aborts at the turn limit, pi may open one more turn whose reply
  // is aborted before any content. endMessage drops that turn.
  private startReply(): void {
    this.modelStarted = Date.now();
    this.turn = { turn: this.turns.length + 1, startedAt: new Date(this.modelStarted).toISOString(), modelMs: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, calls: [] };
    this.turns.push(this.turn);
  }

  private endMessage(m: PiMessage): void {
    if (m.role === "assistant" && isEmptyAbort(m)) {
      if (this.turn && this.turn === this.turns.at(-1)) this.turns.pop();
      this.turn = this.turns.at(-1) ?? null;
      return;
    }
    const converted = toMessage(m);
    if (converted) this.messages.push(converted);
    if (m.role !== "assistant") return;
    this.lastAssistant = m;
    const usage = usageOf(m.usage);
    if (this.turn) {
      this.turn.modelMs += Date.now() - this.modelStarted;
      this.turn.inputTokens += usage.inputTokens;
      this.turn.cacheReadTokens += usage.cacheReadTokens;
      this.turn.cacheWriteTokens += usage.cacheWriteTokens;
      this.turn.outputTokens += usage.outputTokens;
    }
    this.onUsage(usage);
  }

  private endTool(e: PiEvent): void {
    if (!this.turn) return;
    const id = e.toolCallId ?? "";
    const details = e.result?.details;
    const output = textOf(e.result?.content);
    // A tool of pi/extension.ts gives ok and blocked in details; a ClankTalk tool
    // reached over pi's own MCP client gives only isError and the text.
    const blocked = details?.blocked ?? (/clank_talk$/.test(e.toolName ?? "") ? clankBlocked(output) : []);
    this.turn.calls.push({
      id,
      name: e.toolName ?? "",
      arguments: JSON.stringify(e.args ?? this.argsById.get(id) ?? {}),
      outcome: { ok: details?.ok ?? !e.isError, output, blocked },
      ms: e.durationMs ?? 0,
    } satisfies CallLog);
  }
}

const STOP_LINE = /^ASL_STOP (turns|time)$/m;

function stopReasonOf(killedFor: StopReason | null, stderr: string, last: PiMessage | null, code: number | null): [StopReason, string | null] {
  if (killedFor) return [killedFor, null];
  const marked = stderr.match(STOP_LINE);
  if (marked) return [marked[1] as StopReason, null];
  if (last?.stopReason === "length") return ["output-limit", null];
  if (last?.stopReason === "error") return ["error", last.errorMessage ?? "the model call failed"];
  if (code !== 0) return ["error", `pi exited with code ${code}: ${stderr.trim().slice(-2000)}`];
  if (!last) return ["error", `pi gave no reply: ${stderr.trim().slice(-2000)}`];
  return ["done", null];
}

export async function piAgent(input: PiInput): Promise<AgentOutput> {
  const home = mkdtempSync(join(tmpdir(), "asl-pi-"));
  try {
    const { args, env, cwd } = piCommand(input, home);
    let killedFor: StopReason | null = null;
    let stderr = "";
    const child = spawn(input.settings.command ?? "pi", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const kill = (reason: StopReason) => {
      if (killedFor) return;
      killedFor = reason;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    };
    const log = new EventLog(input.system, (usage) => {
      input.spend(usage);
      if (input.overBudget()) kill("budget");
    });
    // Grace beyond the deadline: the extension stops between turns; a model reply
    // or tool call in progress may run a bit over.
    const timer = setTimeout(() => kill("time"), Math.max(0, input.deadline - Date.now()) + 30_000);

    // JSONL framing: split on LF bytes only (see pi docs/json.md).
    let pending = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (let i = pending.indexOf(0x0a); i !== -1; i = pending.indexOf(0x0a)) {
        const line = pending.subarray(0, i).toString("utf8").replace(/\r$/, "");
        pending = pending.subarray(i + 1);
        if (line.trim() === "") continue;
        let event: PiEvent;
        try {
          event = JSON.parse(line) as PiEvent;
        } catch {
          continue; // pi keeps stdout for JSONL; ignore anything else
        }
        log.add(event);
      }
    });
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));

    const code = await new Promise<number | null>((resolve) => {
      child.on("error", (e) => {
        stderr += `\n${e.message}`;
        resolve(null);
      });
      child.on("close", (c) => resolve(c));
    });
    clearTimeout(timer);
    const [stopReason, error] = stopReasonOf(killedFor, stderr, log.lastAssistant, code);
    return { messages: log.messages, turns: log.turns, stopReason, error };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
