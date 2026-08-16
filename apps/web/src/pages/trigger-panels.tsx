import type { TriggerFireDto, TriggerSecretDto } from "@agentos/shared";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { Dot } from "../components/ui/pill";

/** Delivery history, and the one-time reveal of a signing key. */
export function FireRow(props: { fire: TriggerFireDto }): React.JSX.Element {
  const { fire } = props;
  return (
    <li className="flex min-w-0 items-center gap-2.5 px-3.5 py-1.5">
      <Dot tone={fire.accepted ? "live" : "danger"} />
      <span className="shrink-0 text-ink-faint" title={fire.createdAt}>
        {fire.createdAt.slice(0, 19)}
      </span>
      {fire.accepted ? (
        <span className="text-live">accepted</span>
      ) : (
        // A rejection reason comes from the signature check and can be a
        // sentence, which used to push the row wider than the panel.
        <span className="min-w-0 truncate text-danger" title={fire.reason ?? "rejected"}>
          rejected{fire.reason ? `: ${fire.reason}` : ""}
        </span>
      )}
    </li>
  );
}

/**
 * The one screen in the app that shows a secret. It says plainly that this is
 * the only time it will be shown, and hands over a copy button rather than
 * asking the operator to select 64 characters of base64 by hand.
 */
export function SigningKeyPanel(props: {
  trigger: TriggerSecretDto;
  onDismiss: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <Panel className="rise border-gate-line">
      <PanelHeader className="border-b border-gate-line bg-gate-soft">
        <PanelTitle icon={<KeyRound />}>
          <span className="text-gate">
            Signing key for <span className="machine">{props.trigger.name}</span> — shown once,
            never again
          </span>
        </PanelTitle>
      </PanelHeader>
      <div className="space-y-3 p-4">
        <Well>
          <code className="machine block break-all text-ink">{props.trigger.signingKey}</code>
        </Well>
        <div className="flex flex-wrap gap-2">
          <Button
            title="Copy the signing key to the clipboard"
            onClick={() => {
              void navigator.clipboard.writeText(props.trigger.signingKey);
              setCopied(true);
            }}
          >
            <Copy />
            {copied ? "Copied" : "Copy key"}
          </Button>
          <Button variant="ghost" onClick={props.onDismiss}>
            I've saved it, dismiss
          </Button>
        </div>
      </div>
    </Panel>
  );
}
