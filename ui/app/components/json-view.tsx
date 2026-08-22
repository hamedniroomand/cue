import { codeToHtml } from "rangi";
import { githubDark, githubLight } from "rangi/themes";
import { useMemo } from "react";

/**
 * Syntax-highlighted JSON for the raw log view, rendered with rangi. Its
 * output is self-contained HTML: the code text is escaped by the library and
 * colors are inlined as `light-dark()` values, which resolve through the
 * `color-scheme` scoped on the wrapper (see .json-view in app.css) so the
 * palette follows the app's class-based theme toggle.
 */
export function JsonView({ value }: { value: unknown }) {
  const html = useMemo(
    () =>
      codeToHtml(JSON.stringify(value, null, 2), {
        lang: "json",
        theme: { light: githubLight, dark: githubDark },
      }),
    [value],
  );
  // oxlint-disable-next-line react/no-danger -- rangi's documented output path; it escapes the code text
  return <div className="json-view min-w-0" dangerouslySetInnerHTML={{ __html: html }} />;
}
