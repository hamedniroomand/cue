import { describe, expect, test } from "bun:test";
import { GitHub } from "../src/github";
import { makeFakeExec } from "./helpers/fakeExec";

const ISSUE_JSON = JSON.stringify([
  {
    number: 7,
    title: "Fix login",
    body: "It breaks",
    labels: [{ name: "agent:ready" }, { name: "bug" }],
  },
]);

describe("GitHub", () => {
  test("listIssues flattens label objects to names", async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ["gh", "issue", "list", "--repo", "acme/widgets", "--label", "agent:ready"],
        result: { stdout: ISSUE_JSON },
      },
    ]);
    const issues = await new GitHub(exec, "acme/widgets").listIssues("agent:ready");
    expect(issues).toEqual([
      { number: 7, title: "Fix login", body: "It breaks", labels: ["agent:ready", "bug"] },
    ]);
    expect(calls[0]).toContain("--json");
  });

  test("swapLabel edits both labels in one gh call", async () => {
    const { exec, calls } = makeFakeExec([{ match: ["gh", "issue", "edit", "7"] }]);
    await new GitHub(exec, "acme/widgets").swapLabel(7, "agent:ready", "agent:planned");
    expect(calls[0]).toEqual(
      expect.arrayContaining(["--remove-label", "agent:ready", "--add-label", "agent:planned"]),
    );
  });

  test("findComment returns the newest comment containing the marker", async () => {
    const comments = JSON.stringify({
      comments: [{ body: "old <!-- m --> v1" }, { body: "noise" }, { body: "new <!-- m --> v2" }],
    });
    const { exec } = makeFakeExec([
      { match: ["gh", "issue", "view", "7"], result: { stdout: comments } },
    ]);
    const found = await new GitHub(exec, "acme/widgets").findComment(7, "<!-- m -->");
    expect(found).toContain("v2");
  });

  test("findComment returns null when absent", async () => {
    const { exec } = makeFakeExec([
      { match: ["gh", "issue", "view", "7"], result: { stdout: '{"comments":[]}' } },
    ]);
    expect(await new GitHub(exec, "acme/widgets").findComment(7, "<!-- m -->")).toBeNull();
  });

  test("comments returns author logins and bodies in order", async () => {
    const payload = JSON.stringify({
      comments: [
        { author: { login: "cue-bot" }, body: "<!-- m -->plan" },
        { author: { login: "hamed" }, body: "please reconsider" },
        { body: "no author field" },
      ],
    });
    const { exec } = makeFakeExec([
      { match: ["gh", "issue", "view", "7"], result: { stdout: payload } },
    ]);
    const comments = await new GitHub(exec, "acme/widgets").comments(7);
    expect(comments).toEqual([
      { author: "cue-bot", body: "<!-- m -->plan" },
      { author: "hamed", body: "please reconsider" },
      { author: "unknown", body: "no author field" },
    ]);
  });

  test("throws on non-zero gh exit", async () => {
    const { exec } = makeFakeExec([
      { match: ["gh", "issue", "list"], result: { code: 1, stderr: "auth required" } },
    ]);
    await expect(new GitHub(exec, "acme/widgets").listIssues("agent:ready")).rejects.toThrow(
      "gh failed",
    );
  });

  test("createDraftPR returns the PR URL", async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ["gh", "pr", "create"],
        result: { stdout: "https://github.com/acme/widgets/pull/9\n" },
      },
    ]);
    const url = await new GitHub(exec, "acme/widgets").createDraftPR({
      branch: "agent/issue-7",
      base: "main",
      title: "t",
      body: "b",
    });
    expect(url).toBe("https://github.com/acme/widgets/pull/9");
    expect(calls[0]).toContain("--draft");
  });
});
