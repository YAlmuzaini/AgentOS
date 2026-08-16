import type { InboxAnswer, InboxMessageDto, InboxQuestion } from "@agentos/shared";
import { Link } from "@tanstack/react-router";
import { Bot, CheckCircle2, GitBranch, ListChecks, Send, Target } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/form";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Time } from "../components/ui/time";
import { EarlierInThread } from "./inbox-thread";

/**
 * One inbox message, with everything needed to answer it without leaving.
 *
 * The old card showed a body and some buttons: no agent, no card, no clock. At
 * 23:00 that is a question from nobody about nothing, and the operator has to
 * open two other screens before they can answer a yes/no.
 */
export function MessageCard(props: {
  message: InboxMessageDto;
  pending: boolean;
  onReply: (payload: {
    body?: string;
    selectedChoiceId?: string;
    answers?: InboxAnswer[];
  }) => void;
}): React.JSX.Element {
  const { message } = props;
  const open = message.status === "open";
  const questions = message.questions;

  return (
    <Panel>
      <PanelHeader className="flex-wrap gap-y-2 border-b border-edge">
        <PanelTitle icon={<Bot />}>
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="machine text-xs text-ink">{message.agentName ?? "an agent"}</span>
            {questions.length > 1 ? (
              <span className="text-[13px] text-ink-muted">
                needs {questions.length} decisions
              </span>
            ) : (
              <span className="text-[13px] text-ink-muted">
                {message.kind === "multiple-choice" ? "needs a decision" : "left a message"}
              </span>
            )}
          </span>
        </PanelTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Time iso={message.createdAt} className="text-ink-faint" />
          {open ? (
            <StatusPill tone="gate">waiting on you</StatusPill>
          ) : (
            <StatusPill tone="neutral">{message.status}</StatusPill>
          )}
        </div>
      </PanelHeader>

      {/* What it is about, and where to go and look. */}
      {message.subject ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge px-4 py-2 text-xs text-ink-muted">
          {message.subject.kind === "goal" ? (
            <Target className="size-3.5 text-ink-faint" />
          ) : (
            <GitBranch className="size-3.5 text-ink-faint" />
          )}
          <Link
            className="-my-1 inline-flex min-h-11 items-center truncate py-1 text-link hover:underline sm:min-h-0"
            to={message.subject.kind === "goal" ? "/goals" : "/tasks"}
            search={{ id: message.subject.id }}
          >
            {message.subject.name}
          </Link>
          {message.sessionId ? (
            <>
              <span className="text-ink-faint">·</span>
              <Link
                className="machine -my-1 inline-flex min-h-11 items-center py-1 text-link hover:underline sm:min-h-0"
                to="/sessions"
                search={{ id: message.sessionId }}
              >
                session {message.sessionId.slice(0, 8)}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="p-4">
        {questions.length === 0 ? (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{message.body}</p>
        ) : null}

        {questions.length > 0 ? (
          <QuestionForm
            questions={questions}
            answers={message.answers}
            open={open}
            pending={props.pending}
            onSubmit={(answers) => props.onReply({ answers })}
          />
        ) : null}

        {open && questions.length === 0 && message.kind === "multiple-choice" ? (
          <div className="mt-4 space-y-2">
            {message.choices.map((choice) => (
              <Button
                key={choice.id}
                disabled={props.pending}
                className="min-h-11 w-full justify-start"
                onClick={() => props.onReply({ selectedChoiceId: choice.id })}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        ) : null}

        {open && message.kind === "text" ? <TextReply {...props} /> : null}

        {!open ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint">
            <CheckCircle2 className="size-3.5" />
            answered <Time iso={message.answeredAt} />
          </p>
        ) : null}

        {/* An agent that asks, works, and comes back leaves a trail. It reads
            as one conversation here rather than as unrelated cards. */}
        <EarlierInThread message={message} />
      </div>
    </Panel>
  );
}

/**
 * Every question in one form, answered in one submit.
 *
 * The point of asking together is that the operator decides once — so the
 * form does not send anything until all of them are answered, which is also
 * exactly what the server accepts.
 */
function QuestionForm(props: {
  questions: InboxQuestion[];
  answers: InboxAnswer[];
  open: boolean;
  pending: boolean;
  onSubmit: (answers: InboxAnswer[]) => void;
}): React.JSX.Element {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [text, setText] = useState<Record<string, string>>({});

  const answerFor = (question: InboxQuestion): InboxAnswer | null => {
    const choiceId = picked[question.id];
    const written = text[question.id]?.trim();
    if (!choiceId && !written) {
      return null;
    }
    return { questionId: question.id, choiceId, text: written || undefined };
  };
  const answers = props.questions.map(answerFor);
  const complete = answers.every(Boolean);

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete) {
          props.onSubmit(answers as InboxAnswer[]);
        }
      }}
    >
      {props.questions.map((question, index) => {
        const given = props.answers.find((answer) => answer.questionId === question.id);
        return (
          <fieldset key={question.id} className="space-y-2">
            <legend className="flex items-baseline gap-2 text-[13px] font-medium text-ink">
              {props.questions.length > 1 ? (
                <span className="tnum text-xs text-ink-faint">{index + 1}</span>
              ) : null}
              {question.question}
            </legend>
            {question.detail ? (
              <p className="text-xs leading-relaxed text-ink-muted">{question.detail}</p>
            ) : null}

            {props.open ? (
              <div className="space-y-2">
                {question.choices.map((choice) => (
                  <label
                    key={choice.id}
                    className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-control border px-3 text-[13px] transition-colors ${
                      picked[question.id] === choice.id
                        ? "border-edge-strong bg-sunken text-ink"
                        : "border-edge bg-panel text-ink hover:border-edge-strong hover:bg-sunken"
                    }`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={choice.id}
                      checked={picked[question.id] === choice.id}
                      onChange={() =>
                        setPicked((current) => ({ ...current, [question.id]: choice.id }))
                      }
                      className="size-4 accent-solid"
                    />
                    {choice.label}
                  </label>
                ))}
                {question.allowFreeText ? (
                  <Input
                    className="min-h-11 sm:min-h-0"
                    placeholder="or answer in your own words"
                    value={text[question.id] ?? ""}
                    onChange={(event) =>
                      setText((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                    aria-label={`Your own answer to: ${question.question}`}
                  />
                ) : null}
              </div>
            ) : (
              <Well className="text-[13px] text-ink">
                {[
                  question.choices.find((choice) => choice.id === given?.choiceId)?.label,
                  given?.text,
                ]
                  .filter(Boolean)
                  .join(" — ") || "(not answered)"}
              </Well>
            )}
          </fieldset>
        );
      })}

      {props.open ? (
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            className="min-h-11 sm:min-h-0"
            disabled={!complete || props.pending}
          >
            <ListChecks />
            {props.questions.length > 1 ? "Send all answers" : "Send answer"}
          </Button>
          {!complete ? (
            <span className="text-xs text-ink-faint">
              {props.questions.length > 1
                ? "Answer every question — the agent resumes with all of them at once."
                : "Pick one to continue."}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function TextReply(props: {
  pending: boolean;
  onReply: (payload: { body?: string }) => void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  return (
    <form
      className="mt-4 flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) {
          props.onReply({ body: text });
          setText("");
        }
      }}
    >
      <Input
        className="min-h-11 flex-1 sm:min-h-0"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Reply…"
        aria-label="Reply"
      />
      <Button
        type="submit"
        disabled={!text.trim() || props.pending}
        className="min-h-11 sm:min-h-0"
      >
        <Send />
        Send
      </Button>
    </form>
  );
}
