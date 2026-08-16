import type { InboxAnswer } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { ChevronLeft, Inbox } from "lucide-react";
import { useEffect } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, InlineError, Skeleton } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { useActiveProject } from "../hooks/use-project";
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
 * with a way back. Every control clears 44px, and nothing an agent wrote — a
 * 300-character question, a paragraph-long choice — is allowed to push the page
 * sideways at 390px.
 */
export function InboxPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const { id: idFromUrl } = useSearch({ strict: false }) as { id?: string };
  const [selected, setSelected] = useUrlSelection(idFromUrl);

  // Scoped to the project on screen: a question from another workspace is one
  // the operator cannot open the card for, and answering it resumes a session
  // they cannot see.
  const { project } = useActiveProject();
  const projectId = project?.id;

  const messages = useQuery({
    queryKey: ["inbox", projectId],
    queryFn: () => api.inbox(projectId),
    enabled: Boolean(projectId),
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
      // Prefix keys, so both the scoped list here and the top bar's badge
      // refresh whichever project they were asked for.
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

      {messages.isError ? (
        <InlineError>
          Unable to load the inbox. Pending agent requests are not currently available.
        </InlineError>
      ) : null}

      {messages.isLoading ? (
        <InboxSkeleton />
      ) : list.length === 0 ? (
        <Panel className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <EmptyState
            icon={<Inbox />}
            title="No messages require your attention"
            hint="Agent questions and decision requests will appear here."
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

          <div
            className={`min-w-0 space-y-3 lg:min-h-0 lg:overflow-y-auto ${
              active ? "" : "hidden lg:block"
            }`}
          >
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
                  error={reply.error}
                  onReply={(payload) => reply.mutate({ id: active.id, ...payload })}
                />
              </>
            ) : (
              <Panel className="hidden lg:flex lg:min-h-0 lg:flex-col">
                <EmptyState
                  icon={<Inbox />}
                  title="Select a message"
                  hint="Choose a message to review and respond."
                />
              </Panel>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

/**
 * The two panes, at the size they will be. A single stack of grey bars told the
 * operator nothing about which half of the screen was about to appear.
 */
function InboxSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[340px_1fr]">
      <Panel className="divide-y divide-edge overflow-hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="space-y-2 px-3.5 py-3">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        ))}
      </Panel>
      <Panel className="hidden space-y-4 p-4 lg:block">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
        <Skeleton className="h-8.5 w-32" />
      </Panel>
    </div>
  );
}
