import type { DodItem } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";

let nextDraftId = 0;

export function GoalDetail(props: {
  projectId: string;
  goalId: string;
  onChanged: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const goal = useQuery({
    queryKey: ["goal", props.projectId, props.goalId],
    queryFn: () => api.goal(props.projectId, props.goalId),
    refetchInterval: 4000,
  });

  const [draft, setDraft] = useState<DodItem[]>([]);

  // Seed the editable draft once, from whatever checklist the API returned
  // (the heuristic first pass, or an empty list to hand-author from scratch).
  useEffect(() => {
    if (goal.data && !goal.data.dodApproved) {
      setDraft(goal.data.definitionOfDone);
    }
  }, [goal.data?.id, goal.data?.dodApproved]);

  const approve = useMutation({
    mutationFn: (items: DodItem[]) =>
      api.approveGoalDod(props.projectId, props.goalId, { definitionOfDone: items }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goal", props.projectId, props.goalId] });
      props.onChanged();
    },
  });

  const pause = useMutation({
    mutationFn: () => api.pauseGoal(props.projectId, props.goalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goal", props.projectId, props.goalId] });
      props.onChanged();
    },
  });

  const resume = useMutation({
    mutationFn: () => api.resumeGoal(props.projectId, props.goalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goal", props.projectId, props.goalId] });
      props.onChanged();
    },
  });

  if (!goal.data) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold">{goal.data.title}</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{goal.data.spec}</p>
      </header>

      {!goal.data.dodApproved ? (
        <div className="space-y-3 rounded-md border border-edge bg-surface-raised p-3">
          <p className="text-sm font-medium text-gate">
            Nothing runs until you approve this checklist.
          </p>
          <ul className="space-y-1.5">
            {draft.map((item, index) => (
              <li key={item.id} className="flex items-center gap-2">
                <input
                  className="flex-1 rounded-sm border border-edge bg-surface-sunken px-2 py-1 text-sm"
                  value={item.text}
                  onChange={(event) => {
                    const next = [...draft];
                    next[index] = { ...item, text: event.target.value };
                    setDraft(next);
                  }}
                />
                <button
                  className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
                  onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                  type="button"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button
            className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
            type="button"
            onClick={() =>
              setDraft([...draft, { id: `draft-${nextDraftId++}`, text: "", done: false }])
            }
          >
            + add item
          </button>
          <div>
            <button
              className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong disabled:opacity-40"
              disabled={draft.filter((item) => item.text.trim()).length === 0}
              onClick={() => approve.mutate(draft.filter((item) => item.text.trim()))}
            >
              Approve and start
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {goal.data.status}
            </span>
            {goal.data.status === "active" ? (
              <button
                className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
                onClick={() => pause.mutate()}
              >
                Pause
              </button>
            ) : null}
            {goal.data.status === "paused" ? (
              <button
                className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
                onClick={() => resume.mutate()}
              >
                Resume
              </button>
            ) : null}
          </div>
          <ul className="space-y-1">
            {goal.data.definitionOfDone.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={item.done} readOnly disabled />
                <span className={item.done ? "text-ink-faint line-through" : ""}>{item.text}</span>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              Progress log
            </h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-sunken p-2 font-mono text-xs text-ink-muted">
              {goal.data.progressLog || "(nothing logged yet)"}
            </pre>
          </div>
          {goal.data.stoppedReason ? (
            <p className="rounded-sm border border-danger/40 bg-surface-raised p-2 text-xs text-danger">
              stopped: {goal.data.stoppedReason}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
