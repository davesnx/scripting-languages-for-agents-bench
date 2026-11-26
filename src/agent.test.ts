import assert from "node:assert/strict";
import { test } from "node:test";
import { loopAgent, type Model } from "./agent.ts";

/** A model that asks for `perTurn` tool calls every turn, forever. */
const busy = (perTurn: number): Model => {
  let n = 0;
  return {
    async complete() {
      const tool_calls = Array.from({ length: perTurn }, () => ({ id: `c${++n}`, type: "function" as const, function: { name: "run_code", arguments: "{}" } }));
      return { message: { role: "assistant", content: null, tool_calls }, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    },
  };
};

async function run(perTurn: number, maxExecutions: number | undefined) {
  let ran = 0;
  const out = await loopAgent(busy(perTurn))({
    system: "",
    instruction: "",
    tools: [],
    callTool: async () => {
      ran++;
      return { ok: true, output: "", blocked: [] };
    },
    maxTurns: 10,
    maxExecutions,
    deadline: Date.now() + 60_000,
    toolTimeoutSeconds: 10,
    maxOutputChars: 1000,
    overBudget: () => false,
    spend: () => {},
  });
  return { ran, stopReason: out.stopReason, turns: out.turns.length, logged: out.turns.flatMap((t) => t.calls).length };
}

test("the loop runs at most the execution budget, then stops with executions", async () => {
  assert.deepEqual(await run(1, 4), { ran: 4, stopReason: "executions", turns: 5, logged: 4 });
  // Calls of one turn count one by one: the third call of the second turn is not run.
  assert.deepEqual(await run(3, 4), { ran: 4, stopReason: "executions", turns: 2, logged: 4 });
});

test("without a budget, the turn limit stops the loop", async () => {
  assert.deepEqual(await run(1, undefined), { ran: 10, stopReason: "turns", turns: 10, logged: 10 });
});
