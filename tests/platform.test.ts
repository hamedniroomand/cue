import { describe, expect, test } from "bun:test";
import { currentPlatform, POSIX, WINDOWS } from "../src/platform";

describe("platform", () => {
  test("POSIX wraps gate commands in sh -c", () => {
    expect(POSIX.shell("bun test && bun run lint")).toEqual([
      "sh",
      "-c",
      "bun test && bun run lint",
    ]);
  });

  test("WINDOWS wraps gate commands in cmd /d /s /c", () => {
    expect(WINDOWS.shell("bun test && bun run lint")).toEqual([
      "cmd",
      "/d",
      "/s",
      "/c",
      "bun test && bun run lint",
    ]);
  });

  test("POSIX agent env allowlist keeps the unix identity vars and the API key", () => {
    expect(POSIX.agentEnvAllowlist).toEqual([
      "PATH",
      "HOME",
      "SHELL",
      "TERM",
      "USER",
      "TMPDIR",
      "ANTHROPIC_API_KEY",
    ]);
  });

  test("WINDOWS agent env allowlist carries the vars windows processes need to boot", () => {
    for (const key of [
      "PATH",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
      "SYSTEMROOT",
      "COMSPEC",
      "PATHEXT",
      "ANTHROPIC_API_KEY",
    ]) {
      expect(WINDOWS.agentEnvAllowlist).toContain(key);
    }
  });

  test("no allowlist ever includes the GitHub token", () => {
    for (const p of [POSIX, WINDOWS]) {
      expect(p.agentEnvAllowlist).not.toContain("GH_TOKEN");
      expect(p.agentEnvAllowlist).not.toContain("GITHUB_TOKEN");
    }
  });

  test("currentPlatform selects by process.platform", () => {
    expect(currentPlatform()).toBe(process.platform === "win32" ? WINDOWS : POSIX);
  });
});
