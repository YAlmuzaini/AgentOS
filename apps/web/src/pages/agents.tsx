import type { AgentDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Bot, Cpu, Download, Plus, Terminal } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CardBody, CardButton, CardGo, CardHead } from "../components/ui/card";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, Skeleton } from "../components/ui/feedback";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { useUrlSelection } from "../hooks/use-url-selection";
import { AgentDetail } from "./agent-detail";
import { AgentForm } from "./agent-form";
import { agentIcon } from "./agent-icon";
import { NoProject, ProjectPending } from "./project-states";

/**
 * Agents are the thing this product is about, so the index is a grid of cards
 * rather than a column of names — the reference's own agents screen
 * (design-refs/agents/07.jpg), where each agent leads with a glyph, says in a
 * sentence what it is for, and carries its model and run count on the card.
 *
 * The previous shape was a 280px name list pinned beside the detail. It fit
 * fourteen agents into a scroller 280px wide and showed two fields of the
 * sixteen on `AgentDto`, so choosing between "plan-risk" and "plan-review"
 * meant clicking both. The URL is unchanged — `?id=` still selects — so every
 * inbound link, and the ⌘K palette, still land where they did.
 */
export function AgentsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const { id: idFromUrl } = useSearch({ strict: false }) as { id?: string };
  const [selected, setSelected] = useUrlSelection(idFromUrl);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const confirm = useConfirm();

  /** Going back to the grid drops `?id=` too, so a reload does not reopen it. */
  const closeDetail = (): void => {
    setSelected(null);
    void navigate({ to: "/agents", search: {} } as never);
  };

  const agents = useQuery({
    queryKey: ["agents", project?.id],
    queryFn: () => api.agents(project!.id),
    enabled: Boolean(project),
  });
  // The card's run count. Already fetched and cached by the top bar, so this
  // costs a cache read rather than a request.
  const sessions = useQuery({
    queryKey: ["sessions", project?.id],
    queryFn: () => api.sessions(project!.id),
    enabled: Boolean(project),
  });

  // Above the project guards: every hook has to run on every render, and the
  // guards below return early.
  const installBuiltIns = useMutation({
    mutationFn: () => api.installBuiltInAgents(project!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents", project?.id] }),
  });

  /**
   * The one install in the app that genuinely overwrites work.
   *
   * `agents.service.ts` inserts with `onConflictDoUpdate`, so an agent whose
   * name matches a built-in is *replaced* — role prompt, model and grants. An
   * operator who had tightened `plan-risk` and then pressed this would lose
   * that silently, and the button gave them no way to know. Skills and
   * triggers skip what already exists; this one does not, and the dialog is
   * the only place that difference is ever stated.
   */
  const confirmInstall = (): void =>
    confirm({
      kind: "warn",
      title: "Install the built-in agents?",
      body: (
        <>
          This writes the agents that ship with AgentOS into this project.{" "}
          <strong className="font-medium text-ink">
            An agent whose name matches a built-in is overwritten
          </strong>{" "}
          — its role prompt, model and grants are replaced with the shipped ones, and any edits
          you made to it here are lost. Agents you named yourself are untouched.
        </>
      ),
      confirmLabel: "Install built-ins",
      onConfirm: () => installBuiltIns.mutate(),
    });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = agents.data ?? [];
  const open = list.find((agent) => agent.id === selected);
  const runsFor = (agentId: string): number =>
    (sessions.data ?? []).filter((session) => session.agentId === agentId).length;

  const form = (
    <AgentForm
      key={editingId ?? "new"}
      projectId={project.id}
      agent={editingId ? list.find((agent) => agent.id === editingId) : undefined}
      open={creating || Boolean(editingId)}
      onClose={() => {
        setCreating(false);
        setEditingId(null);
      }}
    />
  );

  /* One agent, full width. The grid is one click behind the crumb. */
  if (open) {
    return (
      <Page>
        <PageHeader
          icon={<Bot />}
          parent={{ label: "Agents", onClick: closeDetail }}
          title={open.title}
          actions={
            <Button onClick={() => setCreating(true)}>
              <Plus />
              New agent
            </Button>
          }
        />
        {form}
        <AgentDetail
          projectId={project.id}
          agentId={open.id}
          onEdit={() => setEditingId(open.id)}
          onDeleted={closeDetail}
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        icon={<Bot />}
        title="Agents"
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          // The one near-black surface belongs to the screen's primary action
          // *in its current state*. With agents configured that is "New agent";
          // with none it is "Install built-ins" in the empty state below, and
          // two solid buttons would leave neither of them primary.
          <Button variant={list.length > 0 ? "solid" : "outline"} onClick={() => setCreating(true)}>
            <Plus />
            New agent
          </Button>
        }
      />

      {form}

      {agents.isLoading ? (
        <CardGrid>
          {Array.from({ length: 6 }, (_, index) => (
            <Panel key={index} className="space-y-3 p-4">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-9 shrink-0" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-10" />
              <Skeleton className="h-3.5 w-2/3" />
            </Panel>
          ))}
        </CardGrid>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Bot />}
            title="No agents configured"
            hint="Install the built-in agents, create an agent, or import a configuration from agentos.yml."
            action={
              <Button
                variant="solid"
                onClick={confirmInstall}
                disabled={installBuiltIns.isPending}
              >
                <Download />
                {installBuiltIns.isPending ? "Installing…" : "Install built-ins"}
              </Button>
            }
          />
        </Panel>
      ) : (
        <CardGrid>
          {list.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              runs={runsFor(agent.id)}
              onOpen={() => setSelected(agent.id)}
            />
          ))}
        </CardGrid>
      )}

      {/* The one direction that really does overwrite work: pushing a file that
          was exported before these edits. */}
      <p className="text-xs text-ink-faint">
        Changes apply to new sessions. Run <span className="machine text-ink-muted">agentos pull</span>{" "}
        before <span className="machine text-ink-muted">agentos push</span> to avoid overwriting
        changes made in this interface.
      </p>
    </Page>
  );
}

/**
 * Three across on a desk, two on a laptop, one on a phone. The minimum column
 * is 280px because that is where the reference's own description stops being
 * three readable lines and becomes six words per line.
 */
function CardGrid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
  );
}

function AgentCard({
  agent,
  runs,
  onOpen,
}: {
  agent: AgentDto;
  runs: number;
  onOpen: () => void;
}): React.JSX.Element {
  const Icon = agentIcon(agent);
  return (
    <CardButton onClick={onOpen}>
      <CardHead
        tile={
          <IconTile tone={toneFor(agent.id)}>
            <Icon />
          </IconTile>
        }
        title={agent.title}
        subtitle={agent.name}
        trailing={
          <>
            {/* Nearly every agent can reach the operator, so a pill on every
                card would be decoration. The agent that *cannot* is the one
                worth marking. */}
            {agent.inboxAccess ? null : (
              <StatusPill tone="neutral" title="This agent cannot request operator input during a session.">
                no inbox
              </StatusPill>
            )}
            <CardGo />
          </>
        }
      />

      {/* The role prompt is the agent's one-job contract, and its first
          sentence is the closest thing the product has to a description. */}
      <CardBody>{firstSentence(agent.rolePrompt) || "No role prompt set."}</CardBody>

      <MetaRow className="mt-auto">
        <Meta icon={<Cpu />} machine title={agent.model}>
          {agent.model}
        </Meta>
        <Meta icon={<Terminal />}>
          {runs} {runs === 1 ? "session" : "sessions"}
        </Meta>
      </MetaRow>
    </CardButton>
  );
}

/**
 * Role prompts are written as instructions over several lines. The card wants
 * the claim, not the procedure, so it takes the first sentence and lets the
 * clamp handle a long one.
 */
function firstSentence(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, " ");
  const stop = text.search(/[.!?](\s|$)/);
  return stop === -1 ? text : text.slice(0, stop + 1);
}
