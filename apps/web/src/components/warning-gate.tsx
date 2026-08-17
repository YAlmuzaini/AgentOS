import { CheckboxField } from "./ui/form";
import { Well } from "./ui/panel";

/**
 * Shows every warning and makes the operator say they read them.
 *
 * The server refuses a blueprint apply or a goal activation that carries
 * warnings unless the request acknowledges them. Two screens used to satisfy
 * that by hard-coding `acknowledgeWarnings: true` and never rendering the
 * warnings at all, which turns a deliberate gate into a formality — the
 * operator "acknowledged" text they were never shown.
 *
 * Amber is right here by `DESIGN.md`'s One Meaning Rule: this is something
 * waiting on the human that cannot proceed without them.
 */
export function WarningGate(props: {
  warnings: string[];
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  label?: string;
}): React.JSX.Element | null {
  if (props.warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      <Well className="space-y-1.5 border border-gate-line bg-gate-soft">
        <p className="text-[11px] font-medium tracking-[0.06em] text-gate uppercase">
          {props.warnings.length === 1 ? "1 warning" : `${props.warnings.length} warnings`}
        </p>
        <ul className="space-y-1">
          {props.warnings.map((warning, index) => (
            <li key={`${index}:${warning}`} className="text-xs leading-relaxed text-ink-muted">
              {warning}
            </li>
          ))}
        </ul>
      </Well>
      <CheckboxField
        tone="gate"
        checked={props.acknowledged}
        onCheckedChange={props.onAcknowledge}
        label={props.label ?? "I have read every warning above and want to continue."}
      />
    </div>
  );
}
