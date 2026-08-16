import type { UpdateSettingsInput } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/feedback";
import { Field, FormActions, Input, Switch } from "../components/ui/form";
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

  // Shaped like what it is standing in for — three panels, not one panel of
  // four grey bars, which was a different silhouette from the settled screen
  // and made the page jump when the answer arrived.
  if (!form) {
    return (
      <div className="space-y-5">
        {[0, 1, 2].map((index) => (
          <Panel key={index}>
            <div className="border-b border-edge px-4 py-3">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-3 p-4">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-8.5 w-28" />
            </div>
          </Panel>
        ))}
      </div>
    );
  }

  // The API rejects both of these, and a `min`/`max` on a number input is only
  // enforced by the spinner — typing 99999 walked straight into a 400 with the
  // reason on the server rather than on the field. Clearing the box is the same
  // problem in reverse: `Number("")` is NaN, which serialises to null.
  const outOfRange = (minutes: number, low: number, high: number): boolean =>
    Number.isNaN(minutes) || minutes < low || minutes > high;
  const timeoutError = outOfRange(form.parkedSessionTimeoutMinutes, 0, 20160)
    ? "Between 0 and 20160 minutes (14 days). 0 means no timeout."
    : null;
  const intervalError =
    form.orphanSweepEnabled && outOfRange(form.orphanSweepIntervalMinutes, 5, 1440)
      ? "Between 5 and 1440 minutes."
      : null;

  const saved = settings.data;
  const changed =
    !saved ||
    form.parkedSessionTimeoutMinutes !== saved.parkedSessionTimeoutMinutes ||
    form.orphanSweepEnabled !== saved.orphanSweepEnabled ||
    form.orphanSweepIntervalMinutes !== saved.orphanSweepIntervalMinutes ||
    form.defaultRunner !== saved.defaultRunner;

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
          {/* A real <label>, not an aria-label: the sentence under the number is
              the whole point of the setting and a screen reader was the only
              thing being told what the box was for. */}
          <Field
            label="Wait before releasing the container"
            hint={describeTimeout(form.parkedSessionTimeoutMinutes)}
            error={timeoutError}
          >
            {(id) => (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={20160}
                  value={form.parkedSessionTimeoutMinutes}
                  onChange={(event) =>
                    setForm({ ...form, parkedSessionTimeoutMinutes: Number(event.target.value) })
                  }
                  className="tnum w-28"
                />
                <span className="text-[13px] text-ink-muted">minutes</span>
              </div>
            )}
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader className="border-b border-edge">
          <PanelTitle accent="sky">Orphaned containers</PanelTitle>
          <Switch
            checked={form.orphanSweepEnabled}
            onCheckedChange={(checked) => setForm({ ...form, orphanSweepEnabled: checked })}
            aria-label="Reconcile orphaned containers automatically"
            title="Reconcile orphaned containers automatically"
          />
        </PanelHeader>
        <div className="space-y-4 p-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Compare active runtime containers with AgentOS session records and archive unmatched
            containers. Containers less than ten minutes old are excluded.
          </p>
          <Field
            label="Time between reconciliation checks"
            hint={
              form.orphanSweepEnabled
                ? undefined
                : "Reconciliation is disabled. Unmatched containers remain active until stopped manually."
            }
            error={intervalError}
          >
            {(id) => (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  type="number"
                  min={5}
                  max={1440}
                  disabled={!form.orphanSweepEnabled}
                  value={form.orphanSweepIntervalMinutes}
                  onChange={(event) =>
                    setForm({ ...form, orphanSweepIntervalMinutes: Number(event.target.value) })
                  }
                  className="tnum w-28"
                />
                <span className="text-[13px] text-ink-muted">minutes between checks</span>
              </div>
            )}
          </Field>
        </div>
      </Panel>

      {/* Three panels of policy end in one bar, so "did that save?" is answered
          in the same place every time: what is outstanding on the left, the one
          solid button on the screen on the right. */}
      <FormActions
        message={
          save.isError ? (
            <span className="text-danger">
              {save.error instanceof ApiError
                ? save.error.message
                : "Unable to save project settings."}
            </span>
          ) : changed ? (
            <span className="text-ink-muted">Unsaved changes.</span>
          ) : save.isSuccess ? (
            <span className="text-ink-faint">Settings saved.</span>
          ) : null
        }
      >
        <Button
          type="submit"
          variant="solid"
          disabled={save.isPending || Boolean(timeoutError) || Boolean(intervalError)}
        >
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </FormActions>
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
