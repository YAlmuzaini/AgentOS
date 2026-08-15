import { TASK_STATUSES, type TaskDto, type TaskStatus } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

const COLUMN_TITLE: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

const EMPTY_COLUMN_TEXT: Record<TaskStatus, string> = {
  todo: "No tasks queued. Create one below.",
  doing: "Nothing running right now.",
  review: "Nothing waiting on review.",
  done: "No completed tasks yet.",
};

export function TasksPage(): React.JSX.Element {
  const { project, isLoading } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });

  const run = useMutation({
    mutationFn: (id: string) => api.runTask(projectId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });

  if (isLoading) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }
  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Tasks · {project.name}</h1>
      </header>

      <CreateTaskForm
        projectId={project.id}
        agents={agents.data ?? []}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["tasks", project.id] })}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {TASK_STATUSES.map((status) => {
          const columnTasks = (tasks.data ?? []).filter((task) => task.status === status);
          return (
            <section key={status} className="rounded-md border border-edge bg-surface-raised p-3">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                {COLUMN_TITLE[status]}
              </h2>
              <ul className="space-y-2">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onRun={() => run.mutate(task.id)}
                    onAdvance={(next) => patch.mutate({ id: task.id, status: next })}
                  />
                ))}
              </ul>
              {columnTasks.length === 0 ? (
                <p className="text-sm text-ink-muted">{EMPTY_COLUMN_TEXT[status]}</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard(props: {
  task: TaskDto;
  onRun: () => void;
  onAdvance: (next: TaskStatus) => void;
}): React.JSX.Element {
  const { task } = props;
  return (
    <li className="rounded-md border border-edge bg-surface-sunken p-2.5 text-sm">
      <div className="font-medium">{task.name}</div>
      {task.approvalGate ? (
        <div className="mt-1 text-xs text-gate">approval gate — only you can close this</div>
      ) : null}
      <div className="mt-2 flex gap-2">
        {task.status === "todo" ? (
          <button
            className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
            onClick={props.onRun}
          >
            Run now
          </button>
        ) : null}
        {task.status === "review" ? (
          <button
            className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
            onClick={() => props.onAdvance("done")}
          >
            Approve → done
          </button>
        ) : null}
      </div>
    </li>
  );
}

function CreateTaskForm(props: {
  projectId: string;
  agents: Array<{ id: string; name: string }>;
  onCreated: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [approvalGate, setApprovalGate] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.createTask(props.projectId, {
        name,
        description,
        assigneeType: "agent",
        assigneeAgentId: agentId,
        approvalGate,
        scheduleKind: "now",
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      props.onCreated();
    },
  });

  return (
    <form
      className="grid gap-2 rounded-md border border-edge bg-surface-raised p-3 md:grid-cols-[1fr_1fr_auto_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (name && agentId) {
          create.mutate();
        }
      }}
    >
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Task name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <select
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        value={agentId}
        onChange={(event) => setAgentId(event.target.value)}
      >
        <option value="">assign agent…</option>
        {props.agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={approvalGate}
          onChange={(event) => setApprovalGate(event.target.checked)}
        />
        gate
      </label>
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create &amp; run
      </button>
    </form>
  );
}
