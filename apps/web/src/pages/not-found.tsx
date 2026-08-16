import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/feedback";
import { Page } from "../components/ui/page";
import { Panel } from "../components/ui/panel";

/**
 * The screen an operator reaches by editing the address bar, following a link
 * to something that has since been deleted, or refreshing on a route that only
 * ever existed in a previous version.
 *
 * It was TanStack's default: the two words "Not Found", unstyled, top-left, on
 * a blank sheet — the one screen in the app that looked like nothing had been
 * designed at all. It is also the screen most likely to be someone's first
 * impression of the product, so it now says what happened and offers the way
 * back rather than leaving the operator to reach for the browser's chrome.
 */
export function NotFoundPage(): React.JSX.Element {
  return (
    <Page>
      <Panel>
        <EmptyState
          icon={<Compass />}
          title="Page not found"
          hint={
            <>
              The path <span className="machine text-ink">{path()}</span> is unavailable. It may
              have been renamed or deleted.
            </>
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild variant="solid">
                <Link to="/">Go to overview</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/tasks">Open the board</Link>
              </Button>
            </div>
          }
        />
      </Panel>
    </Page>
  );
}

/** Read at render rather than from the router: this route matched nothing. */
function path(): string {
  return typeof window === "undefined" ? "" : window.location.pathname;
}
