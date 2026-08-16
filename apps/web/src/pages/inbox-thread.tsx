import type { InboxMessageDto } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { InlineError, Skeleton } from "../components/ui/feedback";
import { Well } from "../components/ui/panel";
import { Time } from "../components/ui/time";
import { reflow } from "../lib/prose";

/**
 * What was already asked and answered about this card or goal.
 *
 * An agent does not always get everything it needs in one park: it asks, works
 * with the answer, and comes back. In a flat list those reads as unrelated
 * cards hours apart, so the operator answers the second one without
 * remembering what they said to the first. Collapsed by default — the open
 * question is the thing to act on, and the history is context for it.
 */
export function EarlierInThread(props: {
  message: InboxMessageDto;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const subject = props.message.subject;

  const thread = useQuery({
    queryKey: ["inbox-thread", props.message.projectId, subject?.id],
    queryFn: () =>
      api.inboxThread(props.message.projectId, {
        goalId: subject?.kind === "goal" ? subject.id : undefined,
        taskId: subject?.kind === "task" ? subject.id : undefined,
      }),
    enabled: open && Boolean(subject),
  });

  if (!subject) {
    return null;
  }
  const earlier = (thread.data ?? []).filter((message) => message.id !== props.message.id);

  return (
    <div className="mt-4 border-t border-edge pt-3">
      <Button
        size="sm"
        variant="ghost"
        className="min-h-11 sm:min-h-0"
        onClick={() => setOpen((current) => !current)}
      >
        <MessagesSquare />
        {open ? "Hide earlier messages" : "Earlier in this thread"}
      </Button>

      {open ? (
        <div className="mt-2 space-y-2">
          {thread.isError ? (
            <InlineError>Unable to load earlier messages for {subject.name}.</InlineError>
          ) : thread.isLoading ? (
            // Shaped like the wells it is standing in for, rather than a line
            // of text that shifts everything below it when the answer lands.
            <>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </>
          ) : earlier.length === 0 ? (
            <p className="text-xs text-ink-faint">
              No earlier messages for {subject.name}.
            </p>
          ) : (
            earlier.map((message) => (
              <Well key={message.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="machine text-xs text-ink-muted">
                    {message.agentName ?? "an agent"}
                  </span>
                  <Time iso={message.createdAt} className="text-ink-faint" />
                </div>
                <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                  {reflow(message.body)}
                </p>
                {message.answers.length > 0 || message.selectedChoiceId ? (
                  <p className="text-xs text-ink-muted">
                    Your response:{" "}
                    {message.answers.length > 0
                      ? message.answers
                          .map((answer) => {
                            const question = message.questions.find(
                              (candidate) => candidate.id === answer.questionId,
                            );
                            const label = question?.choices.find(
                              (choice) => choice.id === answer.choiceId,
                            )?.label;
                            return [label, answer.text].filter(Boolean).join(" — ");
                          })
                          .join("; ")
                      : (message.choices.find((choice) => choice.id === message.selectedChoiceId)
                          ?.label ?? message.selectedChoiceId)}
                  </p>
                ) : null}
              </Well>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
