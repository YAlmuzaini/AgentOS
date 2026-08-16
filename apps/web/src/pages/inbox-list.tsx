import type { InboxMessageDto } from "@agentos/shared";
import { MicroLabel } from "../components/ui/panel";
import { Dot } from "../components/ui/pill";
import { Time } from "../components/ui/time";

/**
 * The list half of the inbox.
 *
 * An inbox is a queue you work down, not a stack of cards you scroll: the
 * operator wants to see everything waiting at once, pick one, answer it, and
 * land on the next. So the rows carry only what choosing needs — the decision
 * being asked for, who is asking, how long it has been sitting there — and the
 * reading pane carries the rest.
 *
 * Open messages come first and stay first. Everything answered is history, and
 * history is for looking things up rather than for scanning.
 */
export function InboxList(props: {
  messages: InboxMessageDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const open = props.messages.filter((message) => message.status === "open");
  const done = props.messages.filter((message) => message.status !== "open");

  return (
    <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      {open.length > 0 ? (
        <Section waiting label={`Waiting on you · ${open.length}`}>
          {open.map((message) => (
            <Row
              key={message.id}
              message={message}
              selected={message.id === props.selectedId}
              onSelect={props.onSelect}
            />
          ))}
        </Section>
      ) : null}

      {done.length > 0 ? (
        <Section label={`Answered · ${done.length}`}>
          {done.map((message) => (
            <Row
              key={message.id}
              message={message}
              selected={message.id === props.selectedId}
              onSelect={props.onSelect}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/**
 * A group heading, sticky so the operator always knows which half of the queue
 * they are in.
 *
 * The waiting group wears gate amber. It is a 24px band and it is the only
 * coloured surface on the screen at rest, which keeps it inside the rationing
 * rule while making "something is parked on you" the first thing the eye lands
 * on — this is the one channel an agent has to reach a human, so a queue that
 * looks the same whether or not it holds an open question is the one failure
 * this screen cannot afford.
 */
function Section(props: {
  label: string;
  waiting?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <MicroLabel
        className={`sticky top-0 z-10 block border-b px-3.5 py-1.5 ${
          props.waiting
            ? "border-gate-line bg-gate-soft text-gate"
            : "border-edge bg-sunken"
        }`}
      >
        {props.label}
      </MicroLabel>
      <ul>{props.children}</ul>
    </section>
  );
}

function Row(props: {
  message: InboxMessageDto;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { message } = props;
  const open = message.status === "open";

  return (
    <li className="border-b border-edge last:border-0">
      <button
        type="button"
        // 44px on a phone: this is the row an operator taps one-handed at 23:00.
        className={`flex min-h-11 w-full flex-col gap-1 px-3.5 py-2.5 text-left transition-colors ${
          props.selected ? "bg-sunken" : "hover:bg-sunken/70"
        }`}
        onClick={() => props.onSelect(message.id)}
        aria-current={props.selected}
      >
        {/* The question leads. The agent's name used to be the first line and
            the decision the second, which is the wrong way round: the operator
            is choosing between questions, not between agents. */}
        <span className="flex w-full items-start gap-2">
          {/* The dot is the only thing here that pulses, and only while
              something is genuinely waiting on the human. */}
          {open ? (
            <Dot tone="gate" pulse className="mt-1.5" />
          ) : (
            <span className="mt-1.5 size-1.5 shrink-0" />
          )}
          <span
            className={`min-w-0 flex-1 line-clamp-2 text-[13px] leading-snug break-words ${
              open ? "font-medium text-ink" : "text-ink-muted"
            }`}
          >
            {summarise(message)}
          </span>
          <Time iso={message.createdAt} className="shrink-0 text-ink-faint" />
        </span>

        <span className="flex w-full items-center gap-1.5 pl-3.5 text-xs text-ink-faint">
          <span className="machine min-w-0 shrink truncate">
            {message.agentName ?? "an agent"}
          </span>
          {message.subject ? (
            <>
              <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-edge-strong" />
              <span className="min-w-0 shrink truncate">{message.subject.name}</span>
            </>
          ) : null}
          {message.questions.length > 1 ? (
            <span className="tnum ml-auto shrink-0 pl-1.5">{message.questions.length} qs</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** One line: the decision being asked for, or the note that was left. */
function summarise(message: InboxMessageDto): string {
  if (message.questions.length > 0) {
    return message.questions[0]!.question;
  }
  return message.body.split("\n").find((line) => line.trim()) ?? message.body;
}
