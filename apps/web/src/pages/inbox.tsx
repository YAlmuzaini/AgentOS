import type { InboxMessageDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Send } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Input } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { EnableNotifications } from "./enable-notifications";

/**
 * The only human interrupt channel. Answering an open question resumes the
 * session that is parked on it.
 *
 * This is the one screen with a real mobile contract — it is read one-handed at
 * 23:00 — so every control here clears the 44px touch target on small screens.
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

  const list = messages.data ?? [];
  const open = list.filter((message) => message.status === "open").length;

  return (
    <Page width="reading">
      <PageHeader
        icon={<Inbox />}
        title="Inbox"
        actions={
          <>
            {open > 0 ? (
              <StatusPill tone="gate" dot>
                {open} open
              </StatusPill>
            ) : null}
            <EnableNotifications />
          </>
        }
      />

      {messages.isLoading ? (
        <Panel>
          <SkeletonRows rows={3} />
        </Panel>
      ) : null}

      {list.map((message) => (
        <MessageCard
          key={message.id}
          message={message}
          pending={reply.isPending}
          onReply={(payload) => reply.mutate({ id: message.id, ...payload })}
        />
      ))}

      {!messages.isLoading && list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Inbox />}
            title="Nothing waiting on you"
            hint="An agent that gets stuck or needs a decision will park its question here."
          />
        </Panel>
      ) : null}
    </Page>
  );
}

function MessageCard(props: {
  message: InboxMessageDto;
  pending: boolean;
  onReply: (payload: { body?: string; selectedChoiceId?: string }) => void;
}): React.JSX.Element {
  const { message } = props;
  const [text, setText] = useState("");
  const open = message.status === "open";

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent={open ? "amber" : "emerald"}>
          {message.kind === "multiple-choice" ? "Question" : "Message"}
        </PanelTitle>
        {open ? (
          <StatusPill tone="gate">waiting on you</StatusPill>
        ) : (
          <StatusPill tone="neutral">{message.status}</StatusPill>
        )}
      </PanelHeader>

      <div className="p-4">
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{message.body}</p>

        {open && message.kind === "multiple-choice" ? (
          <div className="mt-4 space-y-2">
            {message.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                disabled={props.pending}
                className="flex min-h-11 w-full items-center rounded-control border border-edge bg-panel px-3 text-left text-[13px] text-ink shadow-lift transition-colors hover:border-edge-strong hover:bg-sunken disabled:opacity-45"
                onClick={() => props.onReply({ selectedChoiceId: choice.id })}
              >
                {choice.label}
              </button>
            ))}
          </div>
        ) : null}

        {open && message.kind === "text" ? (
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
              variant="solid"
              disabled={!text.trim() || props.pending}
              className="min-h-11 sm:min-h-0"
            >
              <Send />
              Send
            </Button>
          </form>
        ) : null}
      </div>
    </Panel>
  );
}
