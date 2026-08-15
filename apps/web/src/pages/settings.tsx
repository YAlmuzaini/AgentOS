import type { UpdateSettingsInput } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { SkeletonRows } from "../components/ui/feedback";
import { Input, Switch } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { useActiveProject } from "../hooks/use-project";

/**
 * Operator policy (SPEC §18).
 *
 * Only things the operator is allowed to change at runtime live here. Anything
 * the deployment owns — credentials, database URLs, the operator token — stays
 * in env, and the page says so rather than pretending those are missing.
 */
export function SettingsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings", projectId],
    queryFn: () => api.settings(projectId!),
    enabled: Boolean(projectId),
  });

  const [form, setForm] = useState<UpdateSettingsInput | null>(null);
  useEffect(() => {
    if (settings.data && !form) {
      setForm({
        parkedSessionTimeoutMinutes: settings.data.parkedSessionTimeoutMinutes,
        orphanSweepEnabled: settings.data.orphanSweepEnabled,
        orphanSweepIntervalMinutes: settings.data.orphanSweepIntervalMinutes,
      });
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (body: UpdateSettingsInput) => api.updateSettings(projectId!, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings", projectId] }),
  });

  if (!project || !form) {
    return (
      <Page width="form">
        <Panel>
          <SkeletonRows rows={4} />
        </Panel>
      </Page>
    );
  }

  return (
    <Page width="form">
      <PageHeader icon={<Settings />} title="Settings" />

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <Panel>
          <PanelHeader className="border-b border-edge">
            <PanelTitle accent="amber">Unanswered questions</PanelTitle>
          </PanelHeader>
          <div className="space-y-4 p-4">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              A session that asks you something keeps its container alive while it waits — that is
              what makes the answer resume the same run. This is how long it waits before giving up
              and freeing the container. The question stays in your inbox either way.
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
                aria-label="Minutes before a parked session gives up"
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
              If AgentOS crashes between starting a container and recording it, nothing points at
              that container any more. This reconciles what the runtime is running against what
              AgentOS knows about, and archives the difference. Containers younger than ten minutes
              are never touched.
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
              {save.error instanceof ApiError ? save.error.message : "could not save"}
            </span>
          ) : null}
          {save.isSuccess && !save.isPending ? (
            <span className="text-[13px] text-ink-faint">
              Saved. The next maintenance pass uses it.
            </span>
          ) : null}
        </div>
      </form>

      <p className="text-xs leading-relaxed text-ink-faint">
        Credentials, the operator token, and the database URL are deployment facts, not settings —
        they live in <span className="machine text-ink-muted">.env</span> and changing them needs a
        restart.
      </p>
    </Page>
  );
}

function describeTimeout(minutes: number): string {
  if (minutes === 0) {
    return "0 — a question is never given up on. The container waits indefinitely, and bills.";
  }
  if (minutes < 60) {
    return `${minutes} minutes.`;
  }
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}.`;
}
