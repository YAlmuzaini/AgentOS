import { Link } from "@tanstack/react-router";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "../components/ui/button";
import { InlineError } from "../components/ui/feedback";
import { IconTile } from "../components/ui/icon-tile";
import { Page } from "../components/ui/page";
import { Panel } from "../components/ui/panel";

/**
 * What the operator sees when a screen throws while rendering.
 *
 * There was no `errorComponent` on the root route, so this case rendered a
 * blank white sheet — the app appeared to have simply stopped, with no message,
 * no way back, and nothing to paste into a bug report. TanStack even warns
 * about it in the console, where nobody operating the product is looking.
 *
 * The message is shown verbatim and in the machine font: it is the one piece of
 * evidence that survives, and paraphrasing it would throw away the only thing
 * worth keeping.
 */
export function RouteErrorPage({ error }: { error: Error }): React.JSX.Element {
  return (
    <Page>
      <Panel className="p-6">
        <IconTile
          size="lg"
          className="mb-4 border-danger-line bg-danger-soft text-danger"
        >
          <TriangleAlert />
        </IconTile>
        <h1 className="text-[15px] font-semibold text-ink">Unable to display this page</h1>
        <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-ink-muted">
          Reload the page. If the problem continues, use the error details below for diagnosis.
        </p>
        <InlineError className="machine mt-4 max-w-prose break-words whitespace-pre-wrap">
          {error.message || String(error)}
        </InlineError>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="solid" onClick={() => window.location.reload()}>
            <RotateCw />
            Reload
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Go to overview</Link>
          </Button>
        </div>
      </Panel>
    </Page>
  );
}
