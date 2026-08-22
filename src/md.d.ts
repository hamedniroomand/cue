// `with { type: "file" }` imports resolve to a path Bun.file() can read —
// on disk under `bun run`, inside the binary under `bun build --compile`.
declare module '*.md' {
  const path: string;
  export default path;
}
