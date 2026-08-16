import type { InboxAnswer } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { ChevronLeft, Inbox } from "lucide-react";
import { useEffect } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { useUrlSelection } from "../hooks/use-url-selection";
import { EnableNotifications } from "./enable-notifications";
import { InboxList } from "./inbox-list";
import { MessageCard } from "./inbox-message";

/**
 * The only human interrupt channel, as an inbox rather than a feed.
 *
 * A queue on the left, the message being answered on the right — because the
 * operator arrives with "what is waiting on me", works down the list, and
 * needs the next one to be one click away. The previous stack of full cards
 * made that a scroll: with three open questions the third was below the fold,
 * and answering the first moved everything under the cursor.
 *
 * This is the one screen with a real mobile contract — it is read one-handed
 * at 23:00 — so below `lg` it is one pane at a time: the list, or the message,
 * with a way back. Every control clears 44px.
 */
export function InboxPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const { id: idFromUrl } = useSearch({ strict: false }) as { id?: string };
  const [selected, setSelected] = useUrlSelection(idFromUrl);

  const messages = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.inbox(),
    refetchInterval: 5000,
  });

  const reply = useMutation({
    mutationFn: (input: {
      id: string;
      body?: string;
      selectedChoiceId?: string;
      answers?: InboxAnswer[];
    }) =>
      api.replyInbox(input.id, {
        body: input.body,
        selectedChoiceId: input.selectedChoiceId,
        answers: input.answers,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["inbox-thread"] });
    },
  });

  const list = messages.data ?? [];
  const open = list.filter((message) => message.status === "open");
  const active = list.find((message) => message.id === selected) ?? null;

  // Land on the thing that is actually waiting — but only where there is a
  // second pane to land in. On a phone the two panes are one screen, so
  // auto-selecting would open a message the operator never chose and hide the
  // queue they came to see.
  useEffect(() => {
    const twoPane = window.matchMedia("(min-width: 1024px)").matches;
    if (twoPane && !selected && open.length > 0) {
      setSelected(open[0]!.id);
    }
  }, [selected, open, setSelected]);

  return (
    <Page fill>
      <PageHeader
        icon={<Inbox />}
        title="Inbox"
        meta={list.length > 0 ? `${list.length} message${list.length === 1 ? "" : "s"}` : undefined}
        actions={
          <>
            {open.length > 0 ? (
              <StatusPill tone="gate" dot>
                {open.length} waiting
              </StatusPill>
            ) : null}
            <EnableNotifications />
          </>
        }
      />

      {messages.isLoading ? (
        <Panel>
          <SkeletonRows rows={4} />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Inbox />}
            title="Nothing waiting on you"
            hint="An agent that gets stuck or needs a decision will park its question here, and push it to your phone."
          />
        </Panel>
      ) : (
        <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[340px_1fr]">
          {/* One pane at a time on a phone: the list until something is picked,
              then the message, with a way back. */}
          <Panel
            className={`h-fit overflow-hidden lg:flex lg:h-auto lg:min-h-0 lg:flex-col ${
              active ? "hidden lg:block" : ""
            }`}
          >
            <InboxList messages={list} selectedId={selected} onSelect={setSelected} />
          </Panel>

          <div className={`min-w-0 space-y-3 ${active ? "" : "hidden lg:block"}`}>
            {active ? (
              <>
                <Button
                  variant="ghost"
                  className="min-h-11 lg:hidden"
                  onClick={() => setSelected(null)}
                >
                  <ChevronLeft />
                  All messages
                </Button>
                <MessageCard
                  message={active}
                  pending={reply.isPending}
                  onReply={(payload) => reply.mutate({ id: active.id, ...payload })}
                />
              </>
            ) : (
              <Panel className="hidden lg:block">
                <EmptyState
                  icon={<Inbox />}
                  title="Nothing waiting on you"
                  hint="Pick a message on the left to read what an agent asked and what you answered."
                />
              </Panel>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
