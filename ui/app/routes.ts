import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("runs", "routes/runs.tsx"),
  route("runs/:issue", "routes/runs.tsx", { id: "runs-issue" }),
] satisfies RouteConfig;
