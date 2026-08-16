import { useQuery } from "@tanstack/react-query";
import { Folder, Pause, Play } from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
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

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="violet">Shared inbox and folder</PanelTitle>
        <span className="machine flex items-center gap-1.5 text-xs text-ink-faint">
          <Folder className="size-3.5" />
          /goals/{props.goalId}/
        </span>
      </PanelHeader>
      <div className="space-y-3 p-4">
        {messages.length === 0 ? (
          <Well>
            <p className="text-[13px] text-ink-faint">
              No messages yet. Every specialist on this goal writes into one thread, and reads it
              before asking — so an answer you give once is not asked for twice.
            </p>
          </Well>
        ) : (
          <ol className="space-y-2.5">
            {messages.map((message) => (
              <li key={message.id} className="rounded-control border border-edge px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-faint">
                    {message.createdAt.slice(0, 19).replace("T", " ")}
                  </span>
                  <StatusPill tone={message.status === "open" ? "gate" : "neutral"}>
                    {message.status}
                  </StatusPill>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                  {message.body}
                </p>
                {message.selectedChoiceId ? (
                  <p className="mt-1.5 text-[13px] text-ink-muted">
                    answered:{" "}
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
