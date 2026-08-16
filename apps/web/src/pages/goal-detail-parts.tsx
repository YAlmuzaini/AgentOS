import type { GoalDto } from "@agentos/shared";
import { Pause, Play } from "lucide-react";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { StatusPill } from "../components/ui/pill";

/** The small rail readouts and the pause/resume controls. */
export function Rail(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt className="text-ink-faint">{props.label}</dt>
      <dd className="tnum mt-0.5 font-medium text-ink">{props.children}</dd>
    </div>
  );
}

export function GoalControls(props: {
  data: { status: string };
  pause: { mutate: () => void; isPending: boolean };
  resume: { mutate: () => void; isPending: boolean };
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {props.data.status === "active" ? (
        <StatusPill tone="live" dot pulse>
          active
        </StatusPill>
      ) : (
        <StatusPill>{props.data.status}</StatusPill>
      )}
      {props.data.status === "active" ? (
        <Button size="sm" onClick={() => props.pause.mutate()} disabled={props.pause.isPending}>
          <Pause />
          Pause
        </Button>
      ) : null}
      {props.data.status === "paused" ? (
        <Button size="sm" onClick={() => props.resume.mutate()} disabled={props.resume.isPending}>
          <Play />
          Resume
        </Button>
      ) : null}
    </div>
  );
}
