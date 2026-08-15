import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;

export function MenuContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}): React.JSX.Element {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-44 rounded-panel border border-edge bg-panel p-1 shadow-pop",
          "data-[state=open]:rise",
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  tone,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  tone?: "default" | "danger";
  className?: string;
}): React.JSX.Element {
  return (
    <DropdownPrimitive.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] outline-none select-none",
        "data-[highlighted]:bg-sunken [&_svg]:size-3.5 [&_svg]:text-ink-faint",
        tone === "danger"
          ? "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger"
          : "text-ink",
        className,
      )}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}

export function MenuSeparator(): React.JSX.Element {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-edge" />;
}

/** The ⌘K chips in the sidebar search, and any other key hint. */
export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-edge bg-sunken px-1 font-sans text-[10px] font-medium text-ink-faint">
      {children}
    </kbd>
  );
}
