import type { AgentDto, TriggerSecretDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Download, Plus, RefreshCw, Webhook } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { DeleteAction } from "../components/ui/delete-action";
import { useConfirm } from "../components/ui/confirm";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, InlineError, Skeleton, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select, Textarea } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
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

  /**
   * The only bulk action in the app that mints credentials.
   *
   * Nothing existing is replaced — the server skips an example whose name is
   * already taken — but each one it does create is a *live webhook endpoint*
   * with its own signing key, and the keys are shown once. That is worth a
   * beat before it happens, and the dialog says which of the two facts the
   * operator actually needs: the endpoints are live, and the keys are now.
   */
  const confirmInstallExamples = (): void =>
    confirm({
      kind: "warn",
      title: "Install the example triggers?",
      body: (
        <>
          This creates the example webhook triggers for any that this project does not already
          have; a trigger you have configured under the same name is skipped. Each new trigger is
          a live endpoint with its own signing key, and those keys are shown once, immediately
          after this — copy them before you leave the screen.
        </>
      ),
      confirmLabel: "Install examples",
      onConfirm: () => installExamples.mutate(),
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
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <>
            {list.length === 0 ? (
              <Button onClick={confirmInstallExamples} disabled={installExamples.isPending}>
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

      {installExamples.isError ? (
        <InlineError>Unable to install the example triggers.</InlineError>
      ) : null}
      {rotate.isError ? (
        <InlineError>
          Unable to rotate the signing key. The existing key remains valid.
        </InlineError>
      ) : null}

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
        incomplete="A name and an agent to run are required."
        error={create.isError ? "Trigger creation failed." : null}
        onSubmit={async () => {
          await create.mutateAsync({ name, agentId, jobPrompt, enabled: true });
          setName("");
          setJobPrompt("");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            {(id) => (
              <Input
                id={id}
                placeholder="kebab-case"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Assign to" required>
            {(id) => (
              <Select id={id} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">Select an agent</option>
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
            hint="Create a signed webhook endpoint or install the example triggers."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={confirmInstallExamples}
                  disabled={installExamples.isPending}
                >
                  <Download />
                  {installExamples.isPending ? "Installing…" : "Install examples"}
                </Button>
                <Button variant="outline" onClick={() => setCreating(true)}>
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
                <TH>Trigger</TH>
                <TH>Agent</TH>
                <TH>State</TH>
                <TH className="w-0" />
              </tr>
            </THead>
            <tbody>
              {list.map((trigger) => (
                <TR key={trigger.id} className={selected === trigger.id ? "bg-sunken" : undefined}>
                  {/* Opening the deliveries pane was a click handler on the
                      `<tr>`, which no keyboard and no screen reader could
                      reach. The name is the control now, and it carries the
                      endpoint URL — the thing the caller is configured with —
                      underneath it. */}
                  <TD className="max-w-[22rem]">
                    <button
                      type="button"
                      onClick={() => setSelected(trigger.id)}
                      aria-pressed={selected === trigger.id}
                      className="flex min-w-0 items-center gap-2.5 rounded-control text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
                    >
                      <IconTile tone={toneFor(trigger.id)} size="sm">
                        <Webhook />
                      </IconTile>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{trigger.name}</span>
                        <span
                          className="machine block truncate text-xs text-ink-muted"
                          title={trigger.url}
                        >
                          {trigger.url}
                        </span>
                      </span>
                    </button>
                  </TD>
                  <TD className="max-w-[12rem]">
                    <MetaRow>
                      <Meta
                        icon={<Bot />}
                        machine={!agents.data?.find((a) => a.id === trigger.agentId)}
                      >
                        {agents.data?.find((a) => a.id === trigger.agentId)?.name ??
                          trigger.agentId}
                      </Meta>
                    </MetaRow>
                  </TD>
                  <TD>
                    {trigger.enabled ? (
                      <StatusPill tone="live" dot>
                        enabled
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">disabled</StatusPill>
                    )}
                  </TD>
                  <TD className="w-0">
                    <div className="flex items-center justify-end gap-1">
                      <DeleteAction
                        what={trigger.name}
                        body={
                          <>
                            The webhook endpoint and its delivery history will be deleted
                            immediately. Subsequent requests to the URL will return 404.
                          </>
                        }
                        onDelete={() => api.deleteTrigger(project.id, trigger.id)}
                        invalidate={[["triggers", project.id]]}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`Rotate the signing key for ${trigger.name}`}
                        onClick={() =>
                          confirm({
                            kind: "warn",
                            title: `Rotate the signing key for “${trigger.name}”?`,
                            body: (
                              <>
                                The current key will be revoked immediately. Update every caller
                                with the replacement key, which will be displayed once.
                              </>
                            ),
                            confirmLabel: "Rotate key",
                            onConfirm: () => rotate.mutate(trigger.id),
                          })
                        }
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
            <PanelTitle accent="sky">Recent deliveries</PanelTitle>
            <StatusPill tone="neutral" className="machine">
              {list.find((trigger) => trigger.id === selected)?.name ?? selected}
            </StatusPill>
          </PanelHeader>
          <div className="p-4">
            {fires.isLoading ? (
              // Deliveries are one-line rows, so the placeholder is one-line
              // rows — `SkeletonRows` would also add its own padding inside
              // padding here.
              <div className="space-y-1.5">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-6" />
                ))}
              </div>
            ) : (fires.data ?? []).length === 0 ? (
              <EmptyState
                icon={<Webhook />}
                title="No deliveries yet"
                hint="Accepted and rejected webhook requests will appear here."
              />
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
