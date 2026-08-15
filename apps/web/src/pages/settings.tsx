import type { UpdateSettingsInput } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
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
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <section className="space-y-3 rounded-md border border-edge bg-surface-raised p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            Unanswered questions
          </h2>
          <p className="text-sm text-ink-muted">
            A session that asks you something keeps its container alive while it waits — that is
            what makes the answer resume the same run. This is how long it waits before giving up
            and freeing the container. The question stays in your inbox either way.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              max={20160}
              value={form.parkedSessionTimeoutMinutes}
              onChange={(event) =>
                setForm({ ...form, parkedSessionTimeoutMinutes: Number(event.target.value) })
              }
              className="w-28 rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm machine"
            />
            <span className="text-ink-muted">minutes</span>
          </label>
          <p className="text-xs text-ink-faint">
            {describeTimeout(form.parkedSessionTimeoutMinutes)}
          </p>
        </section>

        <section className="space-y-3 rounded-md border border-edge bg-surface-raised p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            Orphaned containers
          </h2>
          <p className="text-sm text-ink-muted">
            If AgentOS crashes between starting a container and recording it, nothing points at that
            container any more. This reconciles what the runtime is running against what AgentOS
            knows about, and archives the difference. Containers younger than ten minutes are never
            touched.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.orphanSweepEnabled}
              onChange={(event) =>
                setForm({ ...form, orphanSweepEnabled: event.target.checked })
              }
            />
            <span>Reconcile automatically</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={5}
              max={1440}
              disabled={!form.orphanSweepEnabled}
              value={form.orphanSweepIntervalMinutes}
              onChange={(event) =>
                setForm({ ...form, orphanSweepIntervalMinutes: Number(event.target.value) })
              }
              className="w-28 rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm machine disabled:opacity-50"
            />
            <span className="text-ink-muted">minutes between checks</span>
          </label>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {save.isError ? (
            <span className="text-sm text-danger">
              {save.error instanceof ApiError ? save.error.message : "could not save"}
            </span>
          ) : null}
          {save.isSuccess && !save.isPending ? (
            <span className="text-sm text-ink-faint">
              Saved. The next maintenance pass uses it.
            </span>
          ) : null}
        </div>
      </form>

      <p className="text-xs text-ink-faint">
        Credentials, the operator token, and the database URL are deployment facts, not settings —
        they live in <span className="machine">.env</span> and changing them needs a restart.
      </p>
    </div>
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
