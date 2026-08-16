import { Plus, SquareKanban } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CreateProjectDialog } from "./create-project-dialog";

export function ProjectPending(): React.JSX.Element {
  return (
    <Page>
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

/**
 * What creating this task will actually do.
 *
 * The dialog used to say "run immediately once created" whatever the schedule
 * was, which is wrong for two of the three kinds and misleading about the one
 * thing an operator wants to be sure of: whether this spends money now.
 */
