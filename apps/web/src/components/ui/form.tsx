import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, ChevronDown } from "lucide-react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { cn } from "../../lib/cn";

/**
 * Fields are white on white with a hairline, because the working surface is
 * already white and a grey input well would read as disabled. Focus darkens the
 * border and adds the ring — it never glows.
 */
const FIELD =
  "w-full rounded-control border border-edge bg-panel px-2.5 text-[13px] text-ink transition-colors placeholder:text-ink-faint hover:border-edge-strong focus:border-edge-strong focus:outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-faint";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={cn(FIELD, "h-8.5", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return <textarea className={cn(FIELD, "resize-y py-2 leading-relaxed", className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <div className="relative">
      <select className={cn(FIELD, "h-8.5 appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

/**
 * A labelled field. The label is always rendered and always tied to the control
 * — a placeholder is not a label, and this app is used one-handed at 23:00.
 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.CheckboxProps): React.JSX.Element {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-edge-strong bg-panel transition-colors data-[state=checked]:border-solid data-[state=checked]:bg-solid data-[state=checked]:text-on-solid",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** A checkbox with its label, which is how every checkbox in this app is used. */
export function CheckboxField({
  label,
  checked,
  onCheckedChange,
  tone,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** `gate` for a choice that hands the operator a real consequence. */
  tone?: "default" | "gate";
  className?: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
      <label
        htmlFor={id}
        className={cn(
          "cursor-pointer text-[13px] leading-snug select-none",
          tone === "gate" ? "text-gate" : "text-ink-muted",
        )}
      >
        {label}
      </label>
    </div>
  );
}

export function Switch({
  className,
  ...props
}: SwitchPrimitive.SwitchProps): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-edge-strong transition-colors data-[state=checked]:bg-solid",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-canvas shadow-lift transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

/**
 * The bar that sits under a create form. Actions go right, validation text goes
 * left, so the eye lands on the problem before it lands on the button.
 */
export function FormActions({
  children,
  message,
  className,
}: {
  children: ReactNode;
  message?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-3", className)}>
      {message ? <div className="mr-auto text-xs">{message}</div> : null}
      {children}
    </div>
  );
}
