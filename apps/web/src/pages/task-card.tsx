import type { TaskDto, TaskStatus } from "@agentos/shared";
import { Check, Maximize2, Play } from "lucide-react";
import { Button } from "../components/ui/button";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";

/** One card on the board. The whole thing opens the task. */
export function TaskCard(props: {
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
      {/* The whole card opens the detail — it used to be only the title, which
          gave no sign it was clickable and left the rest of the card inert.
          The action row below stops the click, so running a task never also
          opens a sheet over it. */}
      <Panel
        role="button"
        tabIndex={0}
        onClick={props.onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onOpen();
          }
        }}
        className="group cursor-pointer p-3 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-solid"
      >
        <div className="flex items-start gap-2">
          <span className="flex-1 text-left text-[13px] font-medium text-ink">{task.name}</span>
          {/* The affordance. Faint until hover, so a board of thirty cards does
              not read as thirty buttons. */}
          <Maximize2
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
        {/* Enough of the brief to know what the card is without opening it. */}
        {task.description ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-muted">
            {task.description}
          </p>
        ) : null}
        {/* A pill is a label, not a sentence. The full promise — that an agent
            physically cannot close this — is the title, so the card keeps a
            clean single-line badge at any column width. */}
        {task.approvalGate ? (
          <StatusPill tone="gate" className="mt-2" title="Approval gate — an agent cannot mark this done. Only you can close it.">
            approval gate
          </StatusPill>
        ) : null}
        {action ? (
          <div
            className="mt-3"
            // The card is the open affordance; a button inside it must not also
            // open the sheet it is acting on.
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {action}
          </div>
        ) : null}
      </Panel>
    </li>
  );
}
