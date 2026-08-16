import { TASK_STATUSES, type TaskDto, type TaskStatus } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { SquareKanban } from "lucide-react";
import { api } from "../api";
import { useConfirm } from "../components/ui/confirm";
import { useToast } from "../components/ui/toast";
import { Skeleton } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { CountChip, StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { useUrlSelection } from "../hooks/use-url-selection";
import { TaskCard } from "./task-card";
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
  todo: "No tasks queued.",
  doing: "No tasks in progress.",
  review: "No tasks awaiting review.",
  done: "No completed tasks yet.",
};

/**
 * A column is a *category*, not a state, so its dot takes a data hue or the
 * neutral — The One Meaning Rule. Review used to wear `gate` and Done `live`,
 * which spent the two signal hues on headings that are always on screen and
 * left the amber gate badge on a card competing with the amber heading above
 * it.
 */
const COLUMN_DOT: Record<TaskStatus, string> = {
  todo: "bg-ink-faint",
  doing: "bg-data-sky",
  review: "bg-data-violet",
  done: "bg-data-emerald",
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
        toast.success("Task approved", "The task has been marked as done.");
      }
      void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const run = useMutation({
    mutationFn: (id: string) => api.runTask(projectId!, id),
    onSuccess: () => {
      toast.success("Task queued", "A new agent session is starting.");
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
          This starts an agent session immediately, consumes API credits, and moves the task to
          Doing. This action cannot be reversed.
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
          This closes the approval gate and marks the task as done.
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
  /** The card names the agent it is parked on, so it needs the agent itself. */
  const agentFor = (id: string | null) =>
    id ? (agents.data ?? []).find((agent) => agent.id === id) : undefined;

  return (
    <Page fill>
      <PageHeader
        icon={<SquareKanban />}
        title="Tasks"
        meta={project.name}
        actions={
          gated > 0 ? (
            <StatusPill tone="gate" dot>
              {gated} approval{gated === 1 ? "" : "s"} required
            </StatusPill>
          ) : null
        }
      />

      {/*
        The board is four lanes, not four stubs. Each lane is a sunken track
        that owns its share of the sheet, because the previous version sized
        itself to its cards: an empty project rendered four 65px wells with the
        rest of the page as blank white, which reads as a screen that failed to
        finish loading rather than as a board with nothing on it.

        From `lg` the lanes are a row that scrolls sideways inside itself when
        four 264px tracks no longer fit, so the page body never scrolls
        sideways. Below `lg` they stack — one column on a phone, two on a
        tablet — and the page scrolls as a whole, which is the right behaviour
        when a lane is as tall as its contents.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:flex lg:min-h-0 lg:flex-1 lg:overflow-x-auto lg:overflow-y-hidden">
        {TASK_STATUSES.map((status) => {
          const columnTasks = (tasks.data ?? []).filter((task) => task.status === status);
          return (
            <section
              key={status}
              aria-label={COLUMN_TITLE[status]}
              className="flex min-w-0 flex-col rounded-panel border border-edge bg-sunken lg:min-h-0 lg:min-w-[16.5rem] lg:flex-1"
            >
              {/* The heading stays put while the lane scrolls under it —
                  otherwise a long Done column takes every other column's
                  heading off the screen with it. */}
              <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                <span aria-hidden className={`size-1.5 rounded-full ${COLUMN_DOT[status]}`} />
                <h2 className="min-w-0 truncate text-[13px] font-medium text-ink">
                  {COLUMN_TITLE[status]}
                </h2>
                <CountChip>{columnTasks.length}</CountChip>
              </div>

              {/* One scroll region per lane. The empty line lives inside it
                  rather than after it, and centres in the track it is standing
                  in — at the top of a 700px lane it reads as a caption that
                  lost its list. */}
              <div className="flex min-h-24 flex-1 flex-col overflow-y-auto px-2 pb-2 lg:min-h-0">
                {tasks.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-24 rounded-panel" />
                    <Skeleton className="h-24 rounded-panel" />
                  </div>
                ) : columnTasks.length === 0 ? (
                  <p className="flex flex-1 items-center justify-center px-2 py-6 text-center text-[13px] text-ink-faint">
                    {EMPTY_COLUMN_TEXT[status]}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        agent={agentFor(task.assigneeAgentId)}
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
