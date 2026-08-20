import { isRouteErrorResponse, Outlet, ScrollRestoration, useRouteError } from "react-router";

import { TooltipProvider } from "~/components/ui/tooltip";

export function Root() {
  return (
    <TooltipProvider>
      <Outlet />
      <ScrollRestoration />
    </TooltipProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
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
