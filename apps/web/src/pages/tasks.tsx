import {
  SCHEDULE_KINDS,
  TASK_STATUSES,
  type TaskDto,
  type TaskStatus,
} from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, Play, Plus, SquareKanban } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { useToast } from "../components/ui/toast";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { CheckboxField, Field, FormActions, Input, Select, Textarea } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { MicroLabel, Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { useUrlSelection } from "../hooks/use-url-selection";
import { CreateTaskDialog } from "./create-task-dialog";
import { NoProject, ProjectPending } from "./project-states";
import { TaskDetail } from "./task-detail";

const COLUMN_TITLE: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

const EMPTY_COLUMN_TEXT: Record<TaskStatus, string> = {
  todo: "No tasks queued. Create one.",
  doing: "Nothing running right now.",
  review: "Nothing waiting on review.",
  done: "No completed tasks yet.",
};

type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

const SCHEDULE_LABEL: Record<ScheduleKind, string> = {
  now: "Now",
  at: "At a time",
  cron: "On a cron",
};

const SCHEDULE_CHOICES = SCHEDULE_KINDS.map((kind) => ({
  kind,
  label: SCHEDULE_LABEL[kind],
}));

/** The column head keeps its status colour; the cards below stay neutral. */
const COLUMN_DOT: Record<TaskStatus, string> = {
  todo: "bg-ink-faint",
  doing: "bg-data-sky",
  review: "bg-gate",
  done: "bg-live",
};

export function TasksPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  // The dialog is opened by the top bar's create button via `?new`, so the
  // board itself does not carry a second create control.
  const search = useSearch({ from: "/tasks" });
  const navigate = useNavigate();
  const creating = search.new === true;
  // `?id=` opens the task the command palette was asked for. It was validated
  // on the route and then ignored here, so every search result landed the
  // operator on the board with nothing open.
  const [openTaskId, setOpenTaskId] = useUrlSelection(search.id);
  const confirm = useConfirm();
  const toast = useToast();
  const setCreating = (open: boolean): void => {
    void navigate({ to: "/tasks", search: open ? { new: true } : {}, replace: true });
  };

  const tasks = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.tasks(projectId!),
    enabled: Boolean(projectId),
    // A run moves the card without a user action, so poll while the board is open.
    refetchInterval: 4000,
  });

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled: Boolean(projectId),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; status: TaskStatus }) =>
      api.patchTask(projectId!, input.id, { status: input.status }),
    onSuccess: (_data, input) => {
      if (input.status === "done") {
        toast.success("Task closed", "You approved it — no agent could have.");
      }
      void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const run = useMutation({
    mutationFn: (id: string) => api.runTask(projectId!, id),
    onSuccess: () => {
      toast.success("Task queued", "An agent session is starting. Watch it under Sessions.");
      void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  /**
   * Running a task dispatches a real agent against real credits, and the
   * button sits on every card in the To do column — easy to hit by accident
   * while scanning the board.
   */
  const confirmRun = (task: TaskDto): void =>
    confirm({
      kind: "spend",
      title: `Run “${task.name}” now?`,
      body: (
        <>
          This starts an agent session immediately and consumes API credits. The task moves to
          Doing and cannot be un-run.
        </>
      ),
      confirmLabel: "Run now",
      onConfirm: () => run.mutate(task.id),
    });

  /**
   * Closing a gate is the one action the product promises an agent can never
   * take, so it is worth a beat of the operator's attention.
   */
  const confirmApprove = (task: TaskDto): void => {
    if (!task.approvalGate) {
      patch.mutate({ id: task.id, status: "done" });
      return;
    }
    confirm({
      kind: "gate",
      title: `Approve “${task.name}”?`,
      body: (
        <>
          This closes an approval gate and marks the task done. No agent can do this — only you.
        </>
      ),
      confirmLabel: "Approve → done",
      onConfirm: () => patch.mutate({ id: task.id, status: "done" }),
    });
  };

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const gated = (tasks.data ?? []).filter(
    (task) => task.status === "review" && task.approvalGate,
  ).length;
  // Read from the live list so the sheet follows a card that moves under it.
  const openTask = (tasks.data ?? []).find((task) => task.id === openTaskId) ?? null;

  return (
    <Page fill>
      <PageHeader
        icon={<SquareKanban />}
        title="Tasks"
        meta={project.name}
        actions={
          gated > 0 ? (
            <StatusPill tone="gate" dot>
              {gated} waiting on you
            </StatusPill>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:min-h-0 lg:flex-1 xl:grid-cols-4">
        {TASK_STATUSES.map((status) => {
          const columnTasks = (tasks.data ?? []).filter((task) => task.status === status);
          return (
            <section key={status} className="flex min-w-0 flex-col gap-2 lg:min-h-0">
              {/* The heading stays put while the column scrolls under it —
                  otherwise a long Done column takes every other column's
                  heading off the screen with it. */}
              <div className="flex shrink-0 items-center gap-2 px-0.5">
                <span aria-hidden className={`size-1.5 rounded-full ${COLUMN_DOT[status]}`} />
                <h2 className="text-[13px] font-medium text-ink">{COLUMN_TITLE[status]}</h2>
                <CountChip>{columnTasks.length}</CountChip>
              </div>

              {/* One scroll region per column. The empty state lives inside it
                  rather than after it, so an empty column shows its message at
                  the top instead of pinned to the bottom of the fill. */}
              <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                {columnTasks.length === 0 ? (
                  <p className="rounded-panel border border-dashed border-edge px-3 py-6 text-center text-[13px] text-ink-faint">
                    {EMPTY_COLUMN_TEXT[status]}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        busy={run.isPending || patch.isPending}
                        onOpen={() => setOpenTaskId(task.id)}
                        onRun={() => confirmRun(task)}
                        onAdvance={() => confirmApprove(task)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {openTask ? (
        <TaskDetail
          projectId={project.id}
          task={openTask}
          agents={agents.data ?? []}
          busy={run.isPending || patch.isPending}
          onClose={() => setOpenTaskId(null)}
          onRun={() => confirmRun(openTask)}
          onApprove={() => confirmApprove(openTask)}
        />
      ) : null}

      <CreateTaskDialog
        open={creating}
        onOpenChange={setCreating}
        projectId={project.id}
        agents={agents.data ?? []}
        onCreated={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ["tasks", project.id] });
        }}
      />
    </Page>
  );
}

function TaskCard(props: {
  task: TaskDto;
  busy: boolean;
  onOpen: () => void;
  onRun: () => void;
  onAdvance: (next: TaskStatus) => void;
}): React.JSX.Element {
  const { task } = props;
  const action =
    task.status === "todo" ? (
      <Button size="sm" onClick={props.onRun} disabled={props.busy}>
        <Play />
        Run now
      </Button>
    ) : task.status === "review" ? (
      <Button size="sm" variant="solid" onClick={() => props.onAdvance("done")} disabled={props.busy}>
        <Check />
        Approve → done
      </Button>
    ) : null;

  return (
    <li>
      <Panel className="p-3 transition-colors hover:border-edge-strong">
        {/* The whole card opens the detail; the action buttons below stop the
            click so running a task never also opens a sheet over it. */}
        <button
          type="button"
          className="block w-full text-left text-[13px] font-medium text-ink"
          onClick={props.onOpen}
        >
          {task.name}
        </button>
        {/* A pill is a label, not a sentence. The full promise — that an agent
            physically cannot close this — is the title, so the card keeps a
            clean single-line badge at any column width. */}
        {task.approvalGate ? (
          <StatusPill tone="gate" className="mt-2" title="Approval gate — an agent cannot mark this done. Only you can close it.">
            approval gate
          </StatusPill>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </Panel>
    </li>
  );
}
