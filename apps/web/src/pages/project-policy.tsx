import type { UpdateSettingsInput } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { SkeletonRows } from "../components/ui/feedback";
import { Input, Switch } from "../components/ui/form";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { RunnerPanel } from "./runner-panel";

/**
 * Policy this project runs under, and only this project.
 *
 * It used to live on a page called "Settings" in the global slot at the bottom
 * of the rail, which is where an operator reasonably reads it as an
 * installation-wide choice. It never was: `project_settings` is keyed by
 * project, so two projects can bill to different runners and give up on a
 * parked question after different amounts of time. Moving it behind the gear
 * next to the project name is the fix for a real misreading, not a reshuffle.
 */
export function ProjectPolicy({ projectId }: { projectId: string }): React.JSX.Element {
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings", projectId],
    queryFn: () => api.settings(projectId),
  });

  // Availability of each backend, so the switch below can say when a choice
  // will silently not take effect. Refetched on a timer because a worker that
  // died since the page loaded is exactly the case worth catching.
  const runners = useQuery({
    queryKey: ["runner-status"],
    queryFn: () => api.runnerStatus(),
    refetchInterval: 15_000,
  });

  const [form, setForm] = useState<UpdateSettingsInput | null>(null);
  // Keyed on the project: switching projects while this page is open must load
  // the new project's policy rather than leave the previous one in the form and
  // save it over the top.
  useEffect(() => {
    setForm(null);
  }, [projectId]);
  useEffect(() => {
    if (settings.data && !form) {
      setForm({
        parkedSessionTimeoutMinutes: settings.data.parkedSessionTimeoutMinutes,
        orphanSweepEnabled: settings.data.orphanSweepEnabled,
        orphanSweepIntervalMinutes: settings.data.orphanSweepIntervalMinutes,
        defaultRunner: settings.data.defaultRunner,
      });
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (body: UpdateSettingsInput) => api.updateSettings(projectId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings", projectId] }),
  });

  if (!form) {
    return (
      <Panel>
        <SkeletonRows rows={4} />
      </Panel>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(form);
      }}
    >
      <RunnerPanel
        value={form.defaultRunner}
        onChange={(defaultRunner) => setForm({ ...form, defaultRunner })}
        status={runners.data}
      />

      <Panel>
        <PanelHeader className="border-b border-edge">
          <PanelTitle accent="amber">Response timeout</PanelTitle>
        </PanelHeader>
        <div className="space-y-4 p-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Set how long a session keeps its container while awaiting your response. After the
            timeout, the container is released and the inbox message remains available.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={20160}
              value={form.parkedSessionTimeoutMinutes}
              onChange={(event) =>
                setForm({ ...form, parkedSessionTimeoutMinutes: Number(event.target.value) })
              }
              className="tnum w-28"
              aria-label="Minutes before a waiting session releases its container"
            />
            <span className="text-[13px] text-ink-muted">minutes</span>
          </div>
          <p className="text-xs text-ink-faint">
            {describeTimeout(form.parkedSessionTimeoutMinutes)}
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader className="border-b border-edge">
          <PanelTitle accent="sky">Orphaned containers</PanelTitle>
          <Switch
            checked={form.orphanSweepEnabled}
            onCheckedChange={(checked) => setForm({ ...form, orphanSweepEnabled: checked })}
            aria-label="Reconcile automatically"
          />
        </PanelHeader>
        <div className="space-y-4 p-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Compare active runtime containers with AgentOS session records and archive unmatched
            containers. Containers less than ten minutes old are excluded.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={5}
              max={1440}
              disabled={!form.orphanSweepEnabled}
              value={form.orphanSweepIntervalMinutes}
              onChange={(event) =>
                setForm({ ...form, orphanSweepIntervalMinutes: Number(event.target.value) })
              }
              className="tnum w-28"
              aria-label="Minutes between reconciliation checks"
            />
            <span className="text-[13px] text-ink-muted">minutes between checks</span>
          </div>
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="solid" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.isError ? (
          <span className="text-[13px] text-danger">
            {save.error instanceof ApiError ? save.error.message : "Unable to save project settings."}
          </span>
        ) : null}
        {save.isSuccess && !save.isPending ? (
          <span className="text-[13px] text-ink-faint">Settings saved.</span>
        ) : null}
      </div>
    </form>
  );
}

function describeTimeout(minutes: number): string {
  if (minutes === 0) {
    return "No timeout. The container remains active and may continue to incur costs.";
  }
  if (minutes < 60) {
    return `${minutes} minutes.`;
  }
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}.`;
}
