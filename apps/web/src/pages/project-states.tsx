import { Plus, SquareKanban } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { EmptyState, Skeleton, SkeletonRows } from "../components/ui/feedback";
import { Page } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CreateProjectDialog } from "./create-project-dialog";

/**
 * What every screen shows while the active project is still being resolved.
 *
 * Shaped like a page — a header line with its action, then a panel of rows —
 * because every screen that renders this one opens that way, and a bare stack
 * of grey bars made the header appear a beat later and shove the body down.
 */
export function ProjectPending(): React.JSX.Element {
  return (
    <Page>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8.5 w-28" />
      </div>
      <Panel>
        <SkeletonRows rows={5} />
      </Panel>
    </Page>
  );
}

export function NoProject(): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  return (
    <Page>
      <Panel>
        <EmptyState
          icon={<SquareKanban />}
          title="No project yet"
          hint={
            <>
              A project contains its own agents, repositories, secrets, tasks, and history. Create a
              project or load sample data with <code className="text-ink">pnpm db:seed</code>.
            </>
          }
          action={
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New project
            </Button>
          }
        />
      </Panel>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}
