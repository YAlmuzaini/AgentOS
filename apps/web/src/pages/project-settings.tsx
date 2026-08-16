import { Settings2 } from "lucide-react";
import { MicroLabel } from "../components/ui/panel";
import { Page, PageHeader } from "../components/ui/page";
import { useProjectGate } from "../hooks/use-project";
import { ProjectCode } from "./project-code";
import { ProjectDanger } from "./project-danger";
import { ProjectIdentity } from "./project-identity";
import { ProjectOwns } from "./project-owns";
import { ProjectPolicy } from "./project-policy";
import { NoProject, ProjectPending } from "./project-states";

/**
 * The gear beside the project name.
 *
 * Everything here is scoped to one project: what it is called, what it owns,
 * and the policy its sessions run under. The counterpart is `/settings`, the
 * installation — reachable under "All projects" at the bottom of the rail, and
 * deliberately not reachable from here, because the two being one page is what
 * made them indistinguishable.
 *
 * Laid out in two columns rather than as a narrow form. It was a form when it
 * held four fields; it now holds an inventory and three policy panels, and at
 * `max-w-2xl` that left a 670px column against a void on a desk monitor. The
 * things you *set* run down the main column; the inventory is reference, so it
 * sits in the rail beside them where it can be read while the policy is being
 * changed.
 */
export function ProjectSettingsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();

  if (pending) {
    return <ProjectPending />;
  }
  if (absent || !project) {
    return <NoProject />;
  }

  return (
    <Page>
      <PageHeader icon={<Settings2 />} title={project.name} meta="Project settings" />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <ProjectIdentity project={project} />
          <ProjectPolicy projectId={project.id} />

          {/* Deleting a project is not the next setting down the column. It gets
              its own captioned region behind a rule, so the panel above it ends
              and this one begins rather than the two reading as one stack. */}
          <section className="space-y-3 border-t border-edge pt-6">
            <MicroLabel>Danger zone</MicroLabel>
            <ProjectDanger project={project} />
          </section>
        </div>

        <div className="min-w-0 space-y-5 xl:sticky xl:top-0">
          <ProjectCode projectId={project.id} />
          <ProjectOwns projectId={project.id} />
          <p className="px-1 text-xs leading-relaxed text-ink-faint">
            Shared deployment settings, including credentials, database access, and runner
            configuration, are managed through <span className="machine text-ink-muted">.env</span>{" "}
            and AgentOS settings.
          </p>
        </div>
      </div>
    </Page>
  );
}
