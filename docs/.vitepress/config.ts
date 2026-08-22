import { defineConfig } from "vitepress";

const repo = "https://github.com/hamedniroomand/cue";
const docs = "https://hamedniroomand.github.io/cue";

export default defineConfig({
  srcDir: "content",
  base: "/cue/",
  title: "Cue",
  description:
    "Drive headless coding agents through a GitHub-issue pipeline: triage, human-approved plan, implement, test, review, draft PR.",
  lastUpdated: true,
  cleanUrls: true,
  head: [
    ["link", { rel: "canonical", href: docs }],
    ["meta", { name: "og:title", content: "Cue" }],
    [
      "meta",
      {
        name: "og:description",
        content:
          "A globally-installed CLI that runs coding agents through a fixed GitHub-issue pipeline.",
      },
    ],
  ],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Develop", link: "/develop/setup" },
      { text: "GitHub", link: repo },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Pipeline", link: "/guide/pipeline" },
          { text: "Commands", link: "/guide/commands" },
          { text: "Configuration", link: "/guide/config" },
          { text: "Dashboard", link: "/guide/dashboard" },
        ],
      },
      {
        text: "Develop",
        items: [
          { text: "Clone and setup", link: "/develop/setup" },
          { text: "Architecture", link: "/develop/architecture" },
          { text: "Contributing", link: "/develop/contributing" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/docs/content/:path`,
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Humans approve the plan and the merge. Cue does the rest.",
    },
  },
});
