import { describe, expect, test } from "bun:test";
import { ClaudeAdapter } from "../src/adapters/claude";
import { POSIX, WINDOWS } from "../src/platform";
import { makeFakeExec } from "./helpers/fakeExec";

const STREAM =
  [
    JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me look at the server file first." },
          { type: "tool_use", name: "Bash", input: { command: "bun add hono" } },
        ],
      },
    }),
    JSON.stringify({
      type: "result",
      result: "Here is the plan.",
      total_cost_usd: 0.042,
      num_turns: 6,
    }),
  ].join("\n") + "\n";

const OPTS = {
  prompt: "do the thing",
  cwd: "/tmp/work",
  model: "sonnet",
  maxTurns: 15,
  allowedTools: ["Read", "Grep"],
  timeoutMs: 60_000,
};

describe("ClaudeAdapter", () => {
  test("builds the streaming headless command and parses the result event", async () => {
    const { exec, calls } = makeFakeExec([{ match: ["claude", "-p"], result: { stdout: STREAM } }]);
    const res = await new ClaudeAdapter(exec).run(OPTS);
    expect(res.text).toBe("Here is the plan.");
    expect(res.costUsd).toBe(0.042);
    expect(res.turns).toBe(6);
    expect(Array.isArray(res.raw)).toBe(true);
    const cmd = calls[0]!;
    expect(cmd).toEqual(
      expect.arrayContaining([
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        "sonnet",
        "--max-turns",
        "15",
        "--allowedTools",
        "Read,Grep",
      ]),
    );
  });

  test("reports live progress for tool uses and text snippets", async () => {
    const { exec } = makeFakeExec([{ match: ["claude", "-p"], result: { stdout: STREAM } }]);
    const progress: string[] = [];
    await new ClaudeAdapter(exec).run({ ...OPTS, onProgress: (m) => progress.push(m) });
    expect(progress.some((m) => m.includes("Bash") && m.includes("bun add hono"))).toBe(true);
    expect(progress.some((m) => m.includes("Let me look at the server file"))).toBe(true);
  });

  test("throws when the stream contains no result event", async () => {
    const { exec } = makeFakeExec([
      { match: ["claude", "-p"], result: { stdout: '{"type":"system","subtype":"init"}\n' } },
    ]);
    await expect(new ClaudeAdapter(exec).run(OPTS)).rejects.toThrow("no result event");
  });

  test("throws with stderr excerpt on non-zero exit", async () => {
    const { exec } = makeFakeExec([
      { match: ["claude", "-p"], result: { code: 1, stderr: "invalid api key" } },
    ]);
    await expect(new ClaudeAdapter(exec).run(OPTS)).rejects.toThrow("invalid api key");
  });

  function envSpy() {
    let seenEnv: Record<string, string> | undefined;
    const exec = async (_cmd: string[], opts?: { env?: Record<string, string> }) => {
      seenEnv = opts?.env;
      return { code: 0, stdout: STREAM, stderr: "" };
    };
    return { exec, env: () => seenEnv };
  }

  test("scrubs the environment down to the posix allowlist", async () => {
    process.env.GH_TOKEN = "secret-token";
    process.env.HOME = process.env.HOME ?? "/tmp";
    const { exec, env } = envSpy();
    await new ClaudeAdapter(exec, POSIX).run(OPTS);
    expect(env()).toBeDefined();
    expect(env()!.GH_TOKEN).toBeUndefined();
    expect(env()!.HOME).toBeDefined();
    delete process.env.GH_TOKEN;
  });

  test("scrubs the environment down to the windows allowlist", async () => {
    process.env.GH_TOKEN = "secret-token";
    process.env.USERPROFILE = "C:\\Users\\dev";
    process.env.SYSTEMROOT = "C:\\Windows";
    const { exec, env } = envSpy();
    await new ClaudeAdapter(exec, WINDOWS).run(OPTS);
    expect(env()).toBeDefined();
    expect(env()!.GH_TOKEN).toBeUndefined();
    expect(env()!.USERPROFILE).toBe("C:\\Users\\dev");
    expect(env()!.SYSTEMROOT).toBe("C:\\Windows");
    // posix-only vars must not leak through the windows personality
    expect(env()!.HOME).toBeUndefined();
    expect(env()!.SHELL).toBeUndefined();
    delete process.env.GH_TOKEN;
    delete process.env.USERPROFILE;
    delete process.env.SYSTEMROOT;
  });
});
