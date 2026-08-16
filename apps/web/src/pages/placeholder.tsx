import { Construction } from "lucide-react";
import { EmptyState } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";

/** Sidebar sections whose screen lands in a later phase (SPEC §21). */
export function Placeholder(props: { title: string; phase: string }): React.JSX.Element {
  return (
    <Page>
      <PageHeader title={props.title} />
      <Panel>
        <EmptyState
          icon={<Construction />}
          title={`${props.title} is not available yet`}
          hint={`This feature is planned for ${props.phase}.`}
        />
      </Panel>
    </Page>
  );
}
