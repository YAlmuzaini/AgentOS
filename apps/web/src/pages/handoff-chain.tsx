import { useQuery } from "@tanstack/react-query";
import { GitCommitHorizontal, Route } from "lucide-react";
import { api } from "../api";
import { SkeletonRows } from "../components/ui/feedback";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { Time } from "../components/ui/time";

export function HandoffChain(props: { projectId: string; taskId?: string; goalId?: string; embedded?: boolean }): React.JSX.Element {
  const handoffs = useQuery({
    queryKey: ["handoffs", props.projectId, props.taskId, props.goalId],
    queryFn: () => api.handoffs(props.projectId, { taskId: props.taskId, goalId: props.goalId }),
    refetchInterval: 5000,
  });
  const agents = useQuery({ queryKey: ["agents", props.projectId], queryFn: () => api.agents(props.projectId) });
  const body = handoffs.isLoading ? <SkeletonRows rows={2} /> : (handoffs.data ?? []).length === 0 ? <Well><p className="text-xs text-ink-faint">No handoff has been recorded yet.</p></Well> : <ol className="space-y-3">{(handoffs.data ?? []).map((handoff) => <li key={handoff.id} className="border-t border-edge pt-3 first:border-0 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium text-ink">{agents.data?.find((agent) => agent.id === handoff.fromAgentId)?.title ?? handoff.fromAgentId.slice(0, 8)}</span><Time iso={handoff.createdAt} className="text-ink-faint" /></div><p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted">{handoff.outcome}</p>{handoff.verification.length > 0 ? <p className="mt-1 text-xs text-ink-faint">Verified: {handoff.verification.join(" · ")}</p> : null}{handoff.commitShas.length > 0 ? <p className="machine mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-faint"><GitCommitHorizontal className="size-3" />{handoff.commitShas.join(", ")}</p> : null}{handoff.blockers.length > 0 || handoff.decisionsRequired.length > 0 ? <p className="mt-1 text-xs text-gate">Needs attention: {[...handoff.blockers, ...handoff.decisionsRequired].join(" · ")}</p> : null}{handoff.recommendedNextRole ? <p className="mt-1 text-xs text-ink-faint">Recommended next: <span className="machine text-ink-muted">{handoff.recommendedNextRole}</span></p> : null}</li>)}</ol>;
  if (props.embedded) return body;
  return <Panel><PanelHeader className="border-b border-edge"><PanelTitle accent="violet" icon={<Route />}>Handoff chain</PanelTitle></PanelHeader><div className="p-4">{body}</div></Panel>;
}
