import type { AgentDto, TaskDto, TaskStatus } from "@agentos/shared";
import { Bot, CalendarClock, Check, Clock, GitBranch, Play, Repeat, User } from "lucide-react";
import { Button } from "../components/ui/button";
import { CardBody, CardGo } from "../components/ui/card";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { StatusPill } from "../components/ui/pill";
import { Time } from "../components/ui/time";
import { agentIcon } from "./agent-icon";

/**
 * One card on the board — the most repeated object in the product, so it gets
 * the reference's card treatment (design-refs/agents/07.jpg): a glyph for the
 * agent that owns it, the brief clamped underneath, and a footer row of small
 * facts. It used to carry a name, a clamped description and a timestamp, which
 * meant the two questions an operator actually asks a board — *who has this*
 * and *when does it run* — were both a click away.
 *
 * The whole card opens the task. That is a stretched `<button>` laid over the
 * surface rather than a `role="button"` wrapper, because the card also carries
 * real controls and a `<button>` inside a `<button>` is invalid HTML. The
 * overlay is a positioned sibling, so it paints above the static content and
 * catches the click; the footer row sits back on top of it with `z-10` so its
 * own controls and its gate tooltip still work.
 */
export function TaskCard(props: {
  task: TaskDto;
  /** The agent this card is parked on, when it has one. */
  agent: AgentDto | undefined;
  busy: boolean;
  onOpen: () => void;
  onRun: () => void;
  onAdvance: (next: TaskStatus) => void;
}): React.JSX.Element {
  const { task, agent } = props;
  const Glyph = agent ? agentIcon(agent) : Bot;

  const action =
    task.status === "todo" ? (
      <Button size="sm" onClick={props.onRun} disabled={props.busy}>
        <Play />
        Run now
      </Button>
    ) : task.status === "review" ? (
      <Button
        size="sm"
        variant="solid"
        onClick={() => props.onAdvance("done")}
        disabled={props.busy}
      >
        <Check />
        Approve → done
      </Button>
    ) : null;

  return (
    <li className="group relative flex flex-col gap-2.5 rounded-panel border border-edge bg-panel p-3 transition-colors hover:border-edge-strong focus-within:border-edge-strong">
      <button
        type="button"
        onClick={props.onOpen}
        aria-label={`Open ${task.name}`}
        title={task.name}
        className="absolute inset-0 rounded-panel focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid"
      />

      <div className="flex min-w-0 items-start gap-2.5">
        <IconTile size="sm" tone={agent ? toneFor(agent.id) : "neutral"}>
          <Glyph />
        </IconTile>
        {/* Two lines and then an ellipsis: a task name is a sentence people
            write at speed, and truncating it on one line loses the object of
            the sentence — "Reconcile the Q2 invoice export" becomes
            "Reconcile the Q2…". */}
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug font-medium break-words text-ink">
          {task.name}
        </p>
        <CardGo className="mt-0.5" />
      </div>

      {task.description ? <CardBody lines={2}>{task.description}</CardBody> : null}

      {/* Who has it, when it runs, where it sits in a chain, and when it last
          moved. A board is a snapshot, and a card with no clock on it cannot
          say whether "doing" means since this morning or since Tuesday. */}
      <MetaRow className="mt-auto">
        <Meta icon={<User />} title={agent?.name}>
          {agent ? agent.title : "Unassigned"}
        </Meta>
        {task.scheduleKind === "cron" && task.cron ? (
          <Meta icon={<Repeat />} machine title={task.timezone ?? undefined}>
            {task.cron}
          </Meta>
        ) : null}
        {task.scheduleKind === "at" && task.runAt ? (
          <Meta icon={<CalendarClock />} machine>
            {task.runAt.slice(0, 16).replace("T", " ")}
          </Meta>
        ) : null}
        {task.chainId ? (
          /* chainIndex is zero-based; operators count from one. */
          <Meta icon={<GitBranch />}>step {(task.chainIndex ?? 0) + 1}</Meta>
        ) : null}
        <Meta icon={<Clock />}>
          <Time iso={task.updatedAt} />
        </Meta>
      </MetaRow>

      {task.approvalGate || action ? (
        <div className="relative z-10 flex flex-wrap items-center gap-2 border-t border-edge pt-2.5">
          {/* A pill is a label, not a sentence. The full promise — that an
              agent physically cannot close this — is the title, so the card
              keeps a clean single-line badge at any column width. */}
          {task.approvalGate ? (
            <StatusPill
              tone="gate"
              dot
              title="Approval gate — an agent cannot mark this done. Only you can close it."
            >
              approval gate
            </StatusPill>
          ) : null}
          {action ? <div className="ml-auto">{action}</div> : null}
        </div>
      ) : null}
    </li>
  );
}
