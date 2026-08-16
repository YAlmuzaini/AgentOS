import type { AgentDto, TriggerFireDto, TriggerSecretDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Plus, RefreshCw, Webhook } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select, Textarea } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { FireRow, SigningKeyPanel } from "./trigger-panels";
import { NoProject, ProjectPending } from "./project-states";

export function TriggersPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [selected, setSelected] = useState<string | null>(null);
  // A list, because installing the examples mints several keys at once and the
  // server shows each exactly once. Holding a single one threw the rest away.
  const [revealed, setRevealed] = useState<TriggerSecretDto[]>([]);
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

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
      setRevealed([trigger]);
    },
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.rotateTriggerSecret(projectId!, id),
    onSuccess: (trigger) => {
      void queryClient.invalidateQueries({ queryKey: ["triggers", projectId] });
      setRevealed([trigger]);
    },
  });

  const installExamples = useMutation({
    mutationFn: () => api.installExampleTriggers(projectId!),
    onSuccess: (triggers) => {
      void queryClient.invalidateQueries({ queryKey: ["triggers", projectId] });
      // Every key the server just minted. Discarding them left the operator
      // with triggers they had to rotate before they could configure.
      setRevealed(triggers);
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

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = triggers.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<Webhook />}
        title="Triggers"
        meta={list.length > 0 ? `${list.length} endpoint${list.length === 1 ? "" : "s"}` : undefined}
        actions={
          <>
            {list.length === 0 ? (
              <Button
                onClick={() => installExamples.mutate()}
                disabled={installExamples.isPending}
              >
                <Download />
                {installExamples.isPending ? "Installing…" : "Install examples"}
              </Button>
            ) : null}
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New trigger
            </Button>
          </>
        }
      />

      {revealed.length > 0 ? (
        <div className="space-y-3">
          {revealed.map((trigger) => (
            <SigningKeyPanel
              key={trigger.id}
              trigger={trigger}
              onDismiss={() => setRevealed((keys) => keys.filter((k) => k.id !== trigger.id))}
            />
          ))}
        </div>
      ) : null}

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New trigger"
        description="Creates a signed webhook endpoint. The signing key is shown once."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !agentId}
        onSubmit={async () => {
          await create.mutateAsync({ name, agentId, jobPrompt, enabled: true });
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
            hint="Create one to receive webhooks, or install the examples to see the shape."
            action={
              <div className="flex gap-2">
                <Button onClick={() => installExamples.mutate()}>
                  <Download />
                  Install examples
                </Button>
                <Button variant="solid" onClick={() => setCreating(true)}>
                  <Plus />
                  New trigger
                </Button>
              </div>
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
                          confirm({
                            kind: "warn",
                            title: `Rotate the signing key for “${trigger.name}”?`,
                            body: (
                              <>
                                The current key stops working immediately. Every caller still
                                signing with it will be rejected until you give them the new one,
                                which is shown once and never again.
                              </>
                            ),
                            confirmLabel: "Rotate key",
                            onConfirm: () => rotate.mutate(trigger.id),
                          });
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
