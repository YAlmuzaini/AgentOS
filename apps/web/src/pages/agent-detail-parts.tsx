import type { AgentDto } from "@agentos/shared";
import type { ReactNode } from "react";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";

/** The labelled blocks an agent's grants are read from. */
export function Section(props: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-2 border-b border-edge p-4 last:border-0">
      <PanelTitle icon={props.icon}>{props.title}</PanelTitle>
      {props.children}
    </div>
  );
}

/** One wall. The empty state says what the absence means, not that it is empty. */
export function GrantRow(props: {
  icon: ReactNode;
  label: string;
  items: ReactNode[];
  empty: string;
  last?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-4 ${
        props.last ? "" : "border-b border-edge"
      }`}
    >
      <div className="flex w-40 shrink-0 items-center gap-2 text-[13px] text-ink-muted [&_svg]:size-3.5 [&_svg]:text-ink-faint">
        {props.icon}
        {props.label}
      </div>
      <div className="min-w-0 flex-1">
        {props.items.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{props.empty}</p>
        ) : (
          <ul className="space-y-1.5 text-[13px] text-ink">
            {props.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export type { AgentDto };

/**
 * Where this agent's sessions actually run.
 *
 * `inherit` is the common case and the least informative thing to print: it is
 * the project's setting that decides, and that setting is what bills. So the
 * resolved answer is shown, with its source named.
 */
export function describeRunner(preference: string, projectDefault: string | undefined): string {
  if (preference !== "inherit") {
    return `pinned to ${preference}`;
  }
  return projectDefault ? `runs ${projectDefault} (project default)` : "follows the project default";
}
