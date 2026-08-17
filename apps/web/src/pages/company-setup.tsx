import type { ResourceSlotDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { InlineError } from "../components/ui/feedback";
import { Select } from "../components/ui/form";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { WarningGate } from "../components/warning-gate";

/** The single-operator path from empty project to a fleet that can actually run. */
export function CompanySetup({ projectId }: { projectId: string }): React.JSX.Element {
  const client = useQueryClient();
  const blueprints = useQuery({ queryKey: ["company-blueprints"], queryFn: api.companyBlueprints });
  const installations = useQuery({ queryKey: ["blueprint-installations", projectId], queryFn: () => api.blueprintInstallations(projectId) });
  const slots = useQuery({ queryKey: ["resource-slots", projectId], queryFn: () => api.resourceSlots(projectId) });
  const repos = useQuery({ queryKey: ["repos", projectId], queryFn: () => api.repos(projectId) });
  const mcps = useQuery({ queryKey: ["mcp-connections", projectId], queryFn: () => api.mcpConnections(projectId) });
  const environments = useQuery({ queryKey: ["environments", projectId], queryFn: () => api.environments(projectId) });
  const settings = useQuery({ queryKey: ["settings", projectId], queryFn: () => api.settings(projectId) });
  const [selected, setSelected] = useState("minimal-core");
  const [acknowledged, setAcknowledged] = useState(false);
  const preview = useQuery({
    queryKey: ["blueprint-preview", projectId, selected],
    queryFn: () => api.blueprintPreview(projectId, selected),
    enabled: Boolean(selected),
  });
  const preflight = useQuery({
    queryKey: ["preflight", projectId],
    queryFn: () => api.preflight(projectId),
    enabled: (installations.data?.length ?? 0) > 0,
  });
  const apply = useMutation({
    // Acknowledgement is what the operator actually ticked, never a constant.
    mutationFn: () => api.applyBlueprint(projectId, selected, { acknowledgeWarnings: acknowledged }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["blueprint-installations", projectId] }),
        client.invalidateQueries({ queryKey: ["resource-slots", projectId] }),
        client.invalidateQueries({ queryKey: ["agents", projectId] }),
        client.invalidateQueries({ queryKey: ["skills", projectId] }),
        client.invalidateQueries({ queryKey: ["templates", projectId] }),
        client.invalidateQueries({ queryKey: ["settings", projectId] }),
      ]);
    },
  });
  const resolve = useMutation({
    mutationFn: (input: { slot: ResourceSlotDto; resourceId: string }) =>
      api.resolveResourceSlot(projectId, input.slot.key, { resourceType: input.slot.kind, resourceId: input.resourceId }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["resource-slots", projectId] });
      await client.invalidateQueries({ queryKey: ["preflight", projectId] });
    },
  });

  const installed = installations.data ?? [];
  const report = preflight.data;
  const needsAcknowledgement = (preview.data?.warnings.length ?? 0) > 0;
  return (
    <Panel className="space-y-5 p-5">
      <PanelHeader>
        <div>
          <PanelTitle accent="sky">Company setup</PanelTitle>
          <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-muted">
            Connect the project, install an inert fleet, resolve its resource slots, then prove it is ready. Profiles never grant access by themselves.
          </p>
        </div>
        {report ? <StatusPill tone={report.ready ? "neutral" : "gate"}>{report.ready ? "ready" : `${report.findings.filter((finding) => finding.severity === "error").length} blockers`}</StatusPill> : null}
      </PanelHeader>

      <ol className="space-y-4">
        <SetupStep title="Connect a GitHub repository" done={(repos.data?.length ?? 0) > 0}>
          <p>{(repos.data?.length ?? 0) > 0 ? `${repos.data!.length} project repository connection(s) available.` : "No repository is connected yet."}</p>
          <Button asChild size="sm" variant="outline"><Link to="/repos">Manage repositories</Link></Button>
        </SetupStep>

        <SetupStep title="Select a company profile" done={installed.length > 0}>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Select value={selected} onChange={(event) => { setSelected(event.target.value); setAcknowledged(false); }} aria-label="Company profile">
              {(blueprints.data ?? []).map((profile) => <option key={profile.slug} value={profile.slug}>{profile.name}</option>)}
            </Select>
            <Button size="sm" onClick={() => apply.mutate()} disabled={apply.isPending || preview.isLoading || (needsAcknowledgement && !acknowledged)}>{apply.isPending ? "Applying…" : installed.some((entry) => entry.blueprintSlug === selected) ? "Reapply safely" : "Apply profile"}</Button>
          </div>
          {preview.data ? (
            <p className="text-ink-faint">Preview: {preview.data.create.length} additions, {preview.data.preserve.length} existing items preserved. No grants or credentials will change.</p>
          ) : null}
          <WarningGate
            warnings={preview.data?.warnings ?? []}
            acknowledged={acknowledged}
            onAcknowledge={setAcknowledged}
            label="I have read what this profile will and will not do, and want to apply it."
          />
          {apply.isError ? <InlineError>Unable to apply the company profile.</InlineError> : null}
        </SetupStep>

        <SetupStep title="Choose the execution profile" done={Boolean(settings.data)}>
          <p>Current project policy: <span className="machine text-ink">{settings.data?.defaultRunner ?? "loading"}</span>. Local means no metered-cloud fallback; auto explicitly allows one.</p>
          <Button asChild size="sm" variant="outline"><Link to="/project">Review execution policy</Link></Button>
        </SetupStep>

        <SetupStep title="Resolve resource slots" done={(slots.data?.length ?? 0) > 0 && (slots.data ?? []).filter((slot) => slot.required).every((slot) => slot.resourceId)}>
          {(slots.data ?? []).length === 0 ? <p>Apply a profile to declare its required resources.</p> : (
            <div className="space-y-2">
              {(slots.data ?? []).map((slot) => <SlotRow key={slot.key} slot={slot} repos={repos.data ?? []} mcps={mcps.data ?? []} environments={environments.data ?? []} pending={resolve.isPending} onResolve={(resourceId) => resolve.mutate({ slot, resourceId })} />)}
            </div>
          )}
        </SetupStep>

        <SetupStep title="Run fleet preflight" done={Boolean(report?.ready)}>
          {!report ? <p>Preflight becomes available after a profile is installed.</p> : (
            <>
              <p>{report.ready ? "The declared fleet and resources are ready for dispatch." : "Dispatch remains blocked until every hard finding is resolved."}</p>
              {report.findings.length > 0 ? <Well className="divide-y divide-edge p-0">{report.findings.map((finding, index) => <div key={`${finding.code}:${index}`} className="flex gap-2 px-3 py-2 text-xs"><span className={finding.severity === "error" ? "text-danger" : finding.severity === "warning" ? "text-gate" : "text-ink-faint"}>{finding.severity}</span><span className="text-ink-muted">{finding.message}</span></div>)}</Well> : null}
              <Button size="sm" variant="outline" onClick={() => void preflight.refetch()} disabled={preflight.isFetching}>{preflight.isFetching ? "Checking…" : "Run preflight again"}</Button>
            </>
          )}
        </SetupStep>
      </ol>
    </Panel>
  );
}

function SetupStep({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }): React.JSX.Element {
  return <li className="grid gap-2 border-t border-edge pt-4 sm:grid-cols-[24px_minmax(0,1fr)]"><span className="pt-0.5 text-ink-faint" aria-hidden>{done ? <CheckCircle2 className="size-4 text-ink" /> : <CircleDashed className="size-4" />}</span><div className="space-y-2"><h3 className="text-sm font-medium text-ink">{title}</h3><div className="space-y-2 text-xs leading-relaxed text-ink-muted">{children}</div></div></li>;
}

function SlotRow(props: { slot: ResourceSlotDto; repos: Array<{ id: string; name: string }>; mcps: Array<{ id: string; name: string }>; environments: Array<{ id: string; name: string }>; pending: boolean; onResolve: (id: string) => void }): React.JSX.Element {
  const resources = props.slot.kind === "repo" ? props.repos : props.slot.kind === "environment" ? props.environments : props.mcps;
  return <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)]"><div><span className="font-medium text-ink">{props.slot.label}</span>{props.slot.required ? <span className="ml-1 text-danger">required</span> : <span className="ml-1 text-ink-faint">optional</span>}<p className="text-ink-faint">{props.slot.description}</p></div>{props.slot.kind === "folder" ? <span className="text-ink-faint">Resolve through agentos.yml.</span> : <Select aria-label={props.slot.label} value={props.slot.resourceId ?? ""} disabled={props.pending} onChange={(event) => event.target.value && props.onResolve(event.target.value)}><option value="">Unresolved</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</Select>}</div>;
}
