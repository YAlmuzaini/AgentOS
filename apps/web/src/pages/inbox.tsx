import type { InboxMessageDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { EnableNotifications } from "./enable-notifications";

/**
 * The only human interrupt channel. Answering an open question resumes the
 * session that is parked on it.
 */
export function InboxPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const messages = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.inbox(),
    refetchInterval: 5000,
  });

  const reply = useMutation({
    mutationFn: (input: { id: string; body?: string; selectedChoiceId?: string }) =>
      api.replyInbox(input.id, { body: input.body, selectedChoiceId: input.selectedChoiceId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Inbox</h1>
        <EnableNotifications />
      </header>
      {(messages.data ?? []).map((message) => (
        <MessageCard
          key={message.id}
          message={message}
          onReply={(payload) => reply.mutate({ id: message.id, ...payload })}
        />
      ))}
      {messages.data?.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing waiting on you.</p>
      ) : null}
    </div>
  );
}

function MessageCard(props: {
  message: InboxMessageDto;
  onReply: (payload: { body?: string; selectedChoiceId?: string }) => void;
}): React.JSX.Element {
  const { message } = props;
  const [text, setText] = useState("");
  const open = message.status === "open";

  return (
    <article className="rounded-md border border-edge bg-surface-raised p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {message.kind === "multiple-choice" ? "question" : "message"} · {message.status}
      </div>
      <p className="whitespace-pre-wrap text-sm">{message.body}</p>

      {open && message.kind === "multiple-choice" ? (
        <div className="mt-3 space-y-1.5">
          {message.choices.map((choice) => (
            <button
              key={choice.id}
              className="flex min-h-11 w-full items-center rounded-sm border border-edge px-3 py-2 text-left text-sm hover:bg-edge"
              onClick={() => props.onReply({ selectedChoiceId: choice.id })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}

      {open && message.kind === "text" ? (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) {
              props.onReply({ body: text });
              setText("");
            }
          }}
        >
          <input
            className="flex-1 rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Reply…"
          />
          <button
            className="min-h-11 rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong sm:min-h-0"
            type="submit"
          >
            Send
          </button>
        </form>
      ) : null}
    </article>
  );
}
