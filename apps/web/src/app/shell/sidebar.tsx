import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, KeyRound, LogOut, PanelLeftClose, Search, Settings } from "lucide-react";
import { BASE } from "../../api";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Kbd } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import { NAV } from "../nav";

const ROW =
  "flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-[13px] transition-colors [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * The permanent left rail. It is the warm chrome step: everything in here sits
 * one tone behind the working surface, so the white canvas reads as the thing
 * you are actually operating on.
 */
export function Sidebar({
  onNavigate,
  onCollapse,
  onForgetToken,
}: {
  /** Closes the mobile drawer after a jump; unset on the permanent rail. */
  onNavigate?: () => void;
  onCollapse?: () => void;
  onForgetToken: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-chrome p-3">
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <Link to="/tasks" className="flex items-center gap-2" onClick={onNavigate}>
          <span className="flex size-7 items-center justify-center rounded-[7px] bg-solid text-on-solid">
            <AgentOsMark />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">AgentOS</span>
        </Link>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Close navigation"
            className="rounded-control p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            <PanelLeftClose className="size-4" />
          </button>
        ) : null}
      </div>

      {/*
        Search is a real control shaped like the reference's, but AgentOS has no
        command palette yet, so it links to the one screen that is genuinely a
        search over everything that happened rather than pretending to open one.
      */}
      <Link
        to="/activity"
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-control border border-edge bg-panel px-2.5 py-1.5 text-[13px] text-ink-faint shadow-lift transition-colors hover:border-edge-strong hover:text-ink-muted"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">Search activity</span>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </Link>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-0.5">
        {NAV.map((group, index) => (
          <div key={group.label ?? `lead-${index}`} className="space-y-0.5">
            {group.label ? (
              <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-ink-faint uppercase">
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={cn(ROW, "text-ink-muted hover:bg-sunken hover:text-ink")}
                activeProps={{
                  className: cn(
                    ROW,
                    "border border-edge bg-panel font-medium text-ink shadow-lift",
                    // The active row grows a border, so it would otherwise jump
                    // 1px against its unbordered neighbours.
                    "-mx-px",
                  ),
                }}
              >
                <item.icon />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-0.5">
        <Link
          to="/settings"
          onClick={onNavigate}
          className={cn(ROW, "text-ink-muted hover:bg-sunken hover:text-ink")}
          activeProps={{
            className: cn(ROW, "border border-edge bg-panel font-medium text-ink shadow-lift -mx-px"),
          }}
        >
          <Settings />
          Settings
        </Link>

        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-panel border border-edge bg-panel p-2 text-left shadow-lift transition-colors hover:border-edge-strong"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-sunken text-ink-muted">
                <KeyRound className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">Operator</span>
                <span className="block truncate text-[11px] text-ink-faint">{hostOf(BASE)}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-ink-faint" />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuItem onSelect={onForgetToken} tone="danger">
              <LogOut />
              Forget this token
            </MenuItem>
            <MenuSeparator />
            <MenuItem>
              <span className="machine truncate text-[11px] text-ink-faint">{BASE}</span>
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

/** Four cells, one lit: an agent running inside a bounded, ephemeral box. */
function AgentOsMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1.2" fill="currentColor" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.4" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.4" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url, window.location.origin).host;
  } catch {
    return url;
  }
}
