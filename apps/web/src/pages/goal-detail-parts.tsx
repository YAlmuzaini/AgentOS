import type { GoalDto, GoalStatus } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { CircleSlash2, Clock, DollarSign, Folder, Pause, Play, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { DeleteAction } from "../components/ui/delete-action";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Meter } from "../components/ui/stat";
import { formatDuration, Time } from "../components/ui/time";
import { reflow } from "../lib/prose";

/** The tones a goal's state can wear. Narrowed so a caller cannot invent one. */
type GoalTone = "live" | "gate" | "idle" | "danger" | "neutral";

/**
 * The server is the authority on why something was refused — a goal that is
 * already paused, a checklist it would not take, a spend cap it rejected — so a
 * rejection reaches the operator as the sentence the API sent rather than as a
 * generic failure.
 */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * What a goal's state is called and which tone carries it.
 *
 * The list and the detail header ask the same question and used to answer it
 * with two separate copies of the same conditional, so the same goal could read
 * "awaiting approval" in the list and "draft" beside its own title.
 *
 * `completed` is deliberately not `live`. Live means a thing is running right
 * now — a finished goal is resting and needs nothing, which is what `idle` is
 * for. Green on both would have made "still burning money" and "done an hour
 * ago" the same colour.
 */
export function goalState(goal: { status: GoalStatus; dodApproved: boolean }): {
  label: string;
  tone: GoalTone;
  pulse: boolean;
  /** The long form, for a pill that has more to say than it can show. */
  title?: string;
} {
  if (!goal.dodApproved) {
    return {
      label: "awaiting approval",
      tone: "gate",
      pulse: false,
      title: "An agent cannot start this goal. Only you can approve its definition of done.",
    };
  }
  if (goal.status === "active") {
    return { label: "active", tone: "live", pulse: true };
  }
  // A rail tripped: spend cap, max duration, or stuck-at-19. Each is a real
  // stop the operator has to decide about, so all three read as danger.
  if (goal.status.startsWith("stopped-")) {
    return {
      label: goal.status.replace("stopped-", "stopped: "),
      tone: "danger",
      pulse: false,
      title: "An operating limit stopped this goal. It requires manual review.",
    };
  }
  if (goal.status === "completed") {
    return { label: "completed", tone: "idle", pulse: false };
  }
  return { label: goal.status, tone: "neutral", pulse: false };
}

/**
 * The three things that can stop a goal, each shown as a real value against its
 * own cap.
 *
 * A goal loops on its own, so this panel is the operator's entire safety net.
 * It used to be a run of bare `label: value` readouts — "Spend cap $10.00" told
 * you where the wall was but not how close the goal had got to it, which is the
 * only part anyone opens this screen for.
 */
export function GoalRails({
  goal,
  className,
}: {
  goal: GoalDto;
  className?: string;
}): React.JSX.Element {
  // A goal that is still running is measured against now; a stopped one against
  // the last thing that happened to it, so its elapsed time stops climbing.
  const elapsedMs = goal.startedAt
    ? Math.max(
        (goal.status === "active" ? Date.now() : Date.parse(goal.updatedAt)) -
          Date.parse(goal.startedAt),
        0,
      )
    : 0;
  const elapsedMinutes = elapsedMs / 60_000;

  return (
    <Panel className={`h-fit ${className ?? ""}`}>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="amber">Operating limits</PanelTitle>
        <span className="text-xs text-ink-faint">The goal stops when a limit is reached</span>
      </PanelHeader>

      <RailRow
        icon={<DollarSign />}
        label="Spend"
        used={goal.spendUsd}
        cap={goal.spendCapUsd}
        usedLabel="Spent"
        remainingLabel="Remaining"
        format={(value) => `$${value.toFixed(2)}`}
        tripped={goal.status === "stopped-spend"}
        uncapped="No spend limit configured."
      />

      <RailRow
        icon={<Clock />}
        label="Duration"
        used={elapsedMinutes}
        cap={goal.maxDurationMinutes}
        usedLabel="Elapsed"
        remainingLabel="Left"
        format={(value) => formatDuration(value * 60_000)}
        tripped={goal.status === "stopped-time"}
        uncapped="No duration limit configured."
        note={
          goal.startedAt ? undefined : "Timing begins when the checklist is approved."
        }
      />

      {/*
        No meter here on purpose. The rail counts consecutive iterations that
        made no progress, and the API reports only the total, so a bar of
        `iterations / stuckThreshold` would be a proportion this product does
        not actually have.
      */}
      <RailRow icon={<Repeat />} label="No progress" tripped={goal.status === "stopped-stuck"} last>
        <p className="tnum text-xs text-ink-muted">
          Stops after <span className="font-medium text-ink">{goal.stuckThreshold} iterations</span>{" "}
          without progress. <span className="font-medium text-ink">{goal.iterations}</span> total
          iterations completed.
        </p>
      </RailRow>
    </Panel>
  );
}

/**
 * One rail. With a cap it draws the proportion; with the cap set to `null` it
 * says what the absence means, because "no cap" is a decision the operator made
 * out loud and not a blank field. A rail with no `cap` prop at all has nothing
 * measurable behind it and renders whatever it was given instead.
 */
function RailRow(props: {
  icon: ReactNode;
  label: string;
  /** How much of the rail has been used, in the rail's own unit. */
  used?: number;
  /** Where it stops, `null` for an unarmed rail, absent for an unmeasured one. */
  cap?: number | null;
  usedLabel?: string;
  remainingLabel?: string;
  format?: (value: number) => string;
  /** What it means that this rail has no cap. */
  uncapped?: string;
  /** An extra line under the meter, when the numbers need a caveat. */
  note?: string;
  tripped: boolean;
  last?: boolean;
  /** The body of an unmeasured rail. */
  children?: ReactNode;
}): React.JSX.Element {
  const { used = 0, format = (value: number) => String(value) } = props;
  const measured = props.cap !== undefined;
  const cap = props.cap ?? null;
  const share = cap === null || cap <= 0 ? 0 : used / cap;
  // The bar warns before it stops. Amber here is a data hue on a meter, not a
  // claim that anything is waiting on the operator — that is what gate means.
  const accent = share >= 0.8 ? "amber" : "violet";

  return (
    <div
      className={[
        "space-y-2 px-4 py-3.5",
        props.last ? "" : "border-b border-edge",
        // The one place a tinted row earns its colour: this rail is the reason
        // the goal is not running any more.
        props.tripped ? "bg-danger-soft" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-faint">
          {props.icon}
          <span className="truncate">{props.label}</span>
        </span>
        {props.tripped ? (
          <StatusPill tone="danger" dot>
            limit reached
          </StatusPill>
        ) : cap !== null ? (
          // The cap itself, not just the share of it. "80%" without the number
          // it is 80% of is half a fact on the one panel that exists to say
          // where the wall is.
          <span className="tnum shrink-0 text-xs text-ink-muted">
            {Math.min(Math.round(share * 100), 100)}% of {format(cap)}
          </span>
        ) : measured ? (
          <StatusPill tone="neutral" title={props.uncapped}>
            no cap
          </StatusPill>
        ) : null}
      </div>

      {!measured ? (
        props.children
      ) : cap === null ? (
        <p className="tnum text-xs text-ink-muted">
          <span className="font-medium text-ink">{format(used)}</span> so far. {props.uncapped}
        </p>
      ) : (
        <Meter
          segments={[
            {
              label: props.usedLabel ?? "Used",
              value: used,
              display: format(used),
              accent,
            },
            {
              label: props.remainingLabel ?? "Remaining",
              value: Math.max(cap - used, 0),
              display: format(Math.max(cap - used, 0)),
              accent: "sky",
            },
          ]}
        />
      )}

      {props.note ? <p className="text-xs text-ink-faint">{props.note}</p> : null}
    </div>
  );
}

/**
 * The goal's shared state (SPEC §11): one inbox thread and one folder, across
 * every specialist that ever works it.
 *
 * The flat inbox cannot show this — a goal that ran six sessions has its
 * questions scattered through it in the order they arrived, next to every
 * other card's. Here they read as one conversation, which is what they are.
 */
export function GoalSharedState(props: {
  projectId: string;
  goalId: string;
}): React.JSX.Element {
  const thread = useQuery({
    queryKey: ["goal-inbox", props.projectId, props.goalId],
    queryFn: () => api.goalInbox(props.projectId, props.goalId),
    refetchInterval: 10_000,
  });
  const messages = thread.data ?? [];
  const open = messages.filter((message) => message.status === "open").length;

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="violet">Goal workspace</PanelTitle>
        <div className="flex min-w-0 items-center gap-2">
          {/* An open question is the goal standing still until the operator
              answers it, so it belongs on the header rather than buried in the
              thread below. */}
          {open > 0 ? (
            <StatusPill tone="gate" title="This goal is waiting on your answer.">
              {open} open
            </StatusPill>
          ) : null}
          <span
            className="machine flex min-w-0 items-center gap-1.5 text-xs text-ink-faint"
            title={`/goals/${props.goalId}/`}
          >
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">/goals/{props.goalId}/</span>
          </span>
        </div>
      </PanelHeader>
      <div className="space-y-3 p-4">
        {messages.length === 0 ? (
          <Well>
            <p className="text-[13px] text-ink-faint">
              No messages recorded. All agents assigned to this goal share this thread and folder.
            </p>
          </Well>
        ) : (
          <ol className="space-y-2.5">
            {messages.map((message) => (
              <li key={message.id} className="rounded-control border border-edge px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Time iso={message.createdAt} className="text-ink-faint" />
                  <StatusPill tone={message.status === "open" ? "gate" : "neutral"}>
                    {message.status}
                  </StatusPill>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                  {reflow(message.body)}
                </p>
                {message.selectedChoiceId ? (
                  <p className="mt-1.5 text-[13px] break-words text-ink-muted">
                    Response:{" "}
                    {message.choices.find((choice) => choice.id === message.selectedChoiceId)
                      ?.label ?? message.selectedChoiceId}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

/**
 * Pause, resume, and remove — the three things an operator can do to a goal
 * that is already running.
 *
 * The status pill that used to sit in here is gone: these controls now live in
 * the detail header, a few pixels from the pill that header already carries,
 * and two pills side by side said the same thing twice.
 */
export function GoalControls(props: {
  data: { status: string };
  pause: { mutate: () => void; isPending: boolean };
  resume: { mutate: () => void; isPending: boolean };
  /** Removing the goal itself. Its sessions keep their record. */
  onDelete?: { run: () => Promise<unknown>; projectId: string; title: string };
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {props.data.status === "active" ? (
        <Button size="sm" onClick={() => props.pause.mutate()} disabled={props.pause.isPending}>
          <Pause />
          {props.pause.isPending ? "Pausing…" : "Pause"}
        </Button>
      ) : null}
      {props.data.status === "paused" ? (
        <Button size="sm" onClick={() => props.resume.mutate()} disabled={props.resume.isPending}>
          <Play />
          {props.resume.isPending ? "Resuming…" : "Resume"}
        </Button>
      ) : null}
      {props.onDelete ? (
        <DeleteAction
          what={props.onDelete.title}
          body={
            <>
              This deletes the definition of done and progress log. Existing session records are retained.
            </>
          }
          onDelete={props.onDelete.run}
          invalidate={[["goals", props.onDelete.projectId]]}
        />
      ) : null}
    </div>
  );
}

/**
 * Why a goal is not running any more, in the operator's language.
 *
 * The reason was rendered as a bare error line at the very bottom of the page,
 * under the progress log — the one fact that explains everything above it,
 * placed where it is read last.
 */
export function GoalStopped({ reason }: { reason: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-panel border border-danger-line bg-danger-soft px-4 py-3">
      <CircleSlash2 aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-danger">Goal stopped</p>
        <p className="mt-0.5 text-[13px] break-words text-danger">{reason}</p>
      </div>
    </div>
  );
}
