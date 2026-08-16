import { SquareKanban } from "lucide-react";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page } from "../components/ui/page";
import { Panel } from "../components/ui/panel";

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
  return (
    <Page>
      <Panel>
        <EmptyState
          icon={<SquareKanban />}
          title="No project yet"
          hint={
            <>
              Seed one with <code className="text-ink">pnpm db:seed</code>, then reload.
            </>
          }
        />
      </Panel>
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
