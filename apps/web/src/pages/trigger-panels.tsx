import type { TriggerFireDto, TriggerSecretDto } from "@agentos/shared";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";

/** Delivery history, and the one-time reveal of a signing key. */
export function FireRow(props: { fire: TriggerFireDto }): React.JSX.Element {
  const { fire } = props;
  return (
    <li className="flex items-center gap-2.5 px-3.5 py-1.5">
      <Dot tone={fire.accepted ? "live" : "danger"} />
      <span className="shrink-0 text-ink-faint">{fire.createdAt.slice(0, 19)}</span>
      {fire.accepted ? (
        <span className="text-live">accepted</span>
      ) : (
        <span className="text-danger">rejected{fire.reason ? `: ${fire.reason}` : ""}</span>
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
            Signing key for {props.trigger.name} — shown once, never again
          </span>
        </PanelTitle>
      </PanelHeader>
      <div className="space-y-3 p-4">
        <Well>
          <code className="block break-all text-xs text-ink">{props.trigger.signingKey}</code>
        </Well>
        <div className="flex gap-2">
          <Button
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
