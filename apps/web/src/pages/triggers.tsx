import type { AgentDto, TriggerFireDto, TriggerSecretDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, RefreshCw, Webhook } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select, Textarea } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useActiveProject } from "../hooks/use-project";
import { NoProject } from "./tasks";

export function TriggersPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<TriggerSecretDto | null>(null);
  const [creating, setCreating] = useState(false);

  const triggers = useQuery({
    queryKey: ["triggers", projectId],
    queryFn: () => api.triggers(projectId!),
    enabled: Boolean(projectId),
  });

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createTrigger>[1]) =>
      api.createTrigger(projectId!, body),
    onSuccess: (trigger) => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["triggers", projectId] });
      setRevealed(trigger);
    },
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.rotateTriggerSecret(projectId!, id),
    onSuccess: (trigger) => {
      void queryClient.invalidateQueries({ queryKey: ["triggers", projectId] });
      setRevealed(trigger);
    },
  });

  const fires = useQuery({
    queryKey: ["trigger-fires", projectId, selected],
    queryFn: () => api.triggerFires(projectId!, selected!),
    enabled: Boolean(projectId && selected),
    refetchInterval: 5000,
  });

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [jobPrompt, setJobPrompt] = useState("");

  if (!project) {
    return <NoProject />;
  }

  const list = triggers.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<Webhook />}
        title="Triggers"
        meta={list.length > 0 ? `${list.length} endpoint${list.length === 1 ? "" : "s"}` : undefined}
        actions={
          <Button variant="solid" onClick={() => setCreating(true)}>
            <Plus />
            New trigger
          </Button>
        }
      />

      {revealed ? (
        <SigningKeyPanel trigger={revealed} onDismiss={() => setRevealed(null)} />
      ) : null}

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New trigger"
        description="Creates a signed webhook endpoint. The signing key is shown once."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !agentId}
        onSubmit={() => {
          create.mutate({ name, agentId, jobPrompt, enabled: true });
          setName("");
          setJobPrompt("");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                placeholder="kebab-case"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Assign to">
            {(id) => (
              <Select id={id} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">assign agent…</option>
                {(agents.data ?? []).map((agent: AgentDto) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Job prompt" hint="What the agent should do with an inbound event.">
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={jobPrompt}
              onChange={(event) => setJobPrompt(event.target.value)}
            />
          )}
        </Field>
      </CreatePanel>

      {triggers.isLoading ? (
        <Panel>
          <SkeletonRows />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Webhook />}
            title="No triggers"
            hint="Create one to receive webhooks."
            action={
              <Button variant="solid" onClick={() => setCreating(true)}>
                <Plus />
                New trigger
              </Button>
            }
          />
        </Panel>
      ) : (
        <TableCard>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Agent</TH>
                <TH>URL</TH>
                <TH>State</TH>
                <TH className="w-0" />
              </tr>
            </THead>
            <tbody>
              {list.map((trigger) => (
                <TR
                  key={trigger.id}
                  className={`cursor-pointer ${selected === trigger.id ? "bg-sunken" : ""}`}
                  onClick={() => setSelected(trigger.id)}
                >
                  <TD className="font-medium">{trigger.name}</TD>
                  <TD className="text-ink-muted">
                    {agents.data?.find((a) => a.id === trigger.agentId)?.name ?? trigger.agentId}
                  </TD>
                  <TD className="machine max-w-xs truncate text-xs text-ink-muted">
                    {trigger.url}
                  </TD>
                  <TD>
                    {trigger.enabled ? (
                      <StatusPill tone="live">enabled</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">disabled</StatusPill>
                    )}
                  </TD>
                  <TD>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          rotate.mutate(trigger.id);
                        }}
                      >
                        <RefreshCw />
                        Rotate secret
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}

      {selected ? (
        <Panel>
          <PanelHeader className="border-b border-edge">
            <PanelTitle accent="sky">Recent fires</PanelTitle>
          </PanelHeader>
          <div className="p-4">
            {(fires.data ?? []).length === 0 ? (
              <EmptyState title="No fires yet" />
            ) : (
              <Well className="p-0">
                <ul className="machine divide-y divide-edge text-xs">
                  {(fires.data ?? []).map((fire) => (
                    <FireRow key={fire.id} fire={fire} />
                  ))}
                </ul>
              </Well>
            )}
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}

function FireRow(props: { fire: TriggerFireDto }): React.JSX.Element {
  const { fire } = props;
  return (
    <li className="flex items-center gap-2.5 px-3.5 py-1.5">
      <Dot tone={fire.accepted ? "live" : "danger"} />
      <span className="shrink-0 text-ink-faint">{fire.createdAt.slice(0, 19)}</span>
      {fire.accepted ? (
        <span className="text-live">accepted</span>
      ) : (
        <span className="text-danger">rejected{fire.reason ? `: ${fire.reason}` : ""}</span>
      )}
    </li>
  );
}

/**
 * The one screen in the app that shows a secret. It says plainly that this is
 * the only time it will be shown, and hands over a copy button rather than
 * asking the operator to select 64 characters of base64 by hand.
 */
function SigningKeyPanel(props: {
  trigger: TriggerSecretDto;
  onDismiss: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <Panel className="rise border-gate-line">
      <PanelHeader className="border-b border-gate-line bg-gate-soft">
        <PanelTitle icon={<KeyRound />}>
          <span className="text-gate">
            Signing key for {props.trigger.name} — shown once, never again
          </span>
        </PanelTitle>
      </PanelHeader>
      <div className="space-y-3 p-4">
        <Well>
          <code className="block break-all text-xs text-ink">{props.trigger.signingKey}</code>
        </Well>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(props.trigger.signingKey);
              setCopied(true);
            }}
          >
            <Copy />
            {copied ? "Copied" : "Copy key"}
          </Button>
          <Button variant="ghost" onClick={props.onDismiss}>
            I've saved it, dismiss
          </Button>
        </div>
      </div>
    </Panel>
  );
}
