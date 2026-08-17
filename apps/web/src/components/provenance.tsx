import type { Provenance } from "@agentos/shared";
import { ExternalLink } from "lucide-react";
import { StatusPill } from "./ui/pill";

export function ProvenanceInline({ value }: { value: Provenance }): React.JSX.Element {
  const url = value.canonicalUrl ?? value.repositoryUrl ?? value.marketplaceUrl ?? null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <StatusPill tone="neutral">{value.relationship}</StatusPill>
      {url ? <a className="inline-flex items-center gap-1 truncate text-xs text-accent underline decoration-edge-strong underline-offset-2 hover:decoration-accent focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" href={url} target="_blank" rel="noreferrer" title={url}>source<ExternalLink className="size-3 shrink-0" /></a> : <span className="text-xs text-ink-faint">AgentOS source</span>}
    </span>
  );
}

export function ProvenanceDetail({ value }: { value: Provenance }): React.JSX.Element {
  return <div className="space-y-2 text-xs leading-relaxed text-ink-muted"><ProvenanceInline value={value} />{value.notes ? <p>{value.notes}</p> : null}{value.repositoryPath ? <p className="machine break-all text-ink-faint">{value.repositoryPath}{value.commitSha ? ` @ ${value.commitSha}` : value.version ? ` @ ${value.version}` : ""}</p> : null}{value.license ? <p>License: {value.license}{value.licenseUrl ? <> · <a href={value.licenseUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">terms</a></> : null}</p> : null}</div>;
}
