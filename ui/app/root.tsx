import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { TooltipProvider } from "~/components/ui/tooltip";
import type { Route } from "./+types/root";
import "./app.css";

export const meta: Route.MetaFunction = () => [
  { title: "Conductor — Capital Overview" },
  {
    name: "description",
    content: "Agent pipeline spend, stage throughput, and run transcripts.",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script
          // Runs before first paint so a dark preference never flashes light.
          // Mirrors resolveTheme() in ~/lib/theme.
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{var t=localStorage.getItem("conductor-theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased">
        <TooltipProvider>{children}</TooltipProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something broke";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Not found" : `Error ${error.status}`;
    details = error.status === 404 ? "That route does not exist." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-3 p-6">
      <p className="font-mono text-label-md text-brand-accent uppercase">error</p>
      <h1 className="text-display-md">{message}</h1>
      <p className="text-body-md text-muted-foreground">{details}</p>
      {stack && (
        <pre className="overflow-x-auto rounded-xl bg-card p-4 font-mono text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
