import type { GoalDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";
import { GoalDetail } from "./goal-detail";

export function GoalsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [selected, setSelected] = useState<string | null>(null);

  const goals = useQuery({
    queryKey: ["goals", projectId],
    queryFn: () => api.goals(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createGoal>[1]) => api.createGoal(projectId!, body),
    onSuccess: (goal: GoalDto) => {
      void queryClient.invalidateQueries({ queryKey: ["goals", projectId] });
      setSelected(goal.id);
    },
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <section className="space-y-4">
        <h1 className="text-lg font-semibold">Goals</h1>
        <CreateGoalForm onCreate={(body) => create.mutate(body)} />
        <ul className="space-y-1.5">
          {(goals.data ?? []).map((goal) => (
            <li key={goal.id}>
              <button
                className={`w-full rounded-sm border border-edge px-2.5 py-2 text-left text-sm ${
                  selected === goal.id ? "bg-edge" : "bg-surface-raised"
                }`}
                onClick={() => setSelected(goal.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{goal.title}</span>
                  <StatusBadge status={goal.status} approved={goal.dodApproved} />
                </div>
                <div className="mt-1 machine text-xs text-ink-muted">
                  ${goal.spendUsd.toFixed(2)} of {goal.spendCapUsd !== null ? `$${goal.spendCapUsd.toFixed(2)}` : "no cap"} ·{" "}
                  {goal.iterations} iterations
                </div>
              </button>
            </li>
          ))}
          {goals.data?.length === 0 ? (
            <p className="text-sm text-ink-muted">No goals yet.</p>
          ) : null}
        </ul>
      </section>

      <section>
        {selected ? (
          <GoalDetail
            projectId={project.id}
            goalId={selected}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ["goals", projectId] })}
          />
        ) : (
          <p className="text-sm text-ink-muted">Select a goal to review its definition of done.</p>
        )}
      </section>
    </div>
  );
}

function StatusBadge(props: { status: GoalDto["status"]; approved: boolean }): React.JSX.Element {
  if (!props.approved) {
    return <span className="text-xs text-gate">awaiting approval</span>;
  }
  return <span className="text-xs text-ink-muted">{props.status}</span>;
}

function CreateGoalForm(props: {
  onCreate: (body: {
    title: string;
    spec: string;
    spendCapUsd: number | null;
    acknowledgeNoSpendCap: boolean;
    maxDurationMinutes: number | null;
  }) => void;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [spendCapUsd, setSpendCapUsd] = useState("");
  const [noSpendCap, setNoSpendCap] = useState(false);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("");

  return (
    <form
      className="space-y-2 rounded-md border border-edge bg-surface-raised p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title || !spec) return;
        if (!noSpendCap && !spendCapUsd) return;
        props.onCreate({
          title,
          spec,
          spendCapUsd: noSpendCap ? null : Number(spendCapUsd),
          acknowledgeNoSpendCap: noSpendCap,
          maxDurationMinutes: maxDurationMinutes ? Number(maxDurationMinutes) : null,
        });
        setTitle("");
        setSpec("");
        setSpendCapUsd("");
        setNoSpendCap(false);
        setMaxDurationMinutes("");
      }}
    >
      <input
        className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Spec — what the goal is, in as much detail as you have"
        rows={4}
        value={spec}
        onChange={(event) => setSpec(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <input
          className="w-32 rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm disabled:opacity-40"
          type="number"
          min="0"
          step="0.01"
          placeholder="Spend cap $"
          value={spendCapUsd}
          disabled={noSpendCap}
          onChange={(event) => setSpendCapUsd(event.target.value)}
        />
        <input
          className="w-40 rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
          type="number"
          min="0"
          placeholder="Max duration (min)"
          value={maxDurationMinutes}
          onChange={(event) => setMaxDurationMinutes(event.target.value)}
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-gate">
        <input
          type="checkbox"
          checked={noSpendCap}
          onChange={(event) => setNoSpendCap(event.target.checked)}
        />
        run without a spend cap (an unbounded goal can run overnight and cost real money)
      </label>
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}
