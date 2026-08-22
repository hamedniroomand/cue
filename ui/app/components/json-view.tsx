import { codeToHtml } from "rangi";
import { useMemo } from "react";

/**
 * Syntax-highlighted JSON for the raw log view, rendered with rangi in class
 * mode: the markup carries no style attribute at all (the code text is still
 * escaped by the library), and .json-view in app.css owns every color, font,
 * and wrap rule. Inline mode was tried first and rejected — it hardcodes
 * `color-scheme: light dark`, so its light-dark() colors follow the OS while
 * the app's theme toggle is class-based, and it inlines its own font stack.
 */
export function JsonView({ value }: { value: unknown }) {
  const html = useMemo(
    () =>
      codeToHtml(JSON.stringify(value, null, 2), {
        lang: "json",
        classes: true,
        // No gutter: long string values wrap, and wrapped lines would drift
        // out of step with a line-number column.
        lineNumbers: false,
      }),
    [value],
  );
  // oxlint-disable-next-line react/no-danger -- rangi's documented output path; it escapes the code text
  return <div className="json-view min-w-0" dangerouslySetInnerHTML={{ __html: html }} />;
}
