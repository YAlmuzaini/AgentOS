import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  LogOut,
  Menu as MenuIcon,
  MoreVertical,
  Plus,
  Search,
} from "lucide-react";
import { api } from "../../api";
import { Button } from "../../components/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "../../components/ui/menu";
import { StatusPill } from "../../components/ui/pill";
import { useActiveProject } from "../../hooks/use-project";

/**
 * The top bar carries what is true of the whole control plane, not of the
 * screen underneath it: how many sessions are running, and whether anything is
 * parked waiting on the operator.
 *
 * The reference puts a filled black "Upgrade" pill here. AgentOS has nothing to
 * upgrade to — PRODUCT.md is explicit that there is no monetisation — so that
 * slot stays empty and the one solid button on any screen belongs to that
 * screen's own primary action.
 */
export function Topbar({
  onOpenNav,
  onForgetToken,
  onOpenSearch,
}: {
  onOpenNav: () => void;
  onForgetToken: () => void;
  onOpenSearch: () => void;
}): React.JSX.Element {
  // Both counts are about the project on screen. A badge that also counted
  // another project's parked questions would send the operator to an inbox
  // where the number does not appear.
  const { project } = useActiveProject();
  const projectId = project?.id;

  const sessions = useQuery({
    queryKey: ["sessions", projectId],
    queryFn: () => api.sessions(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });
  const inbox = useQuery({
    queryKey: ["inbox", projectId],
    // Wrapped rather than passed by reference: `api.inbox` takes optional
    // filters, and React Query would hand it the query context.
    queryFn: () => api.inbox(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });

  const running = (sessions.data ?? []).filter((session) => session.status === "running").length;
  const waiting = (inbox.data ?? []).filter((message) => message.status === "open").length;

  // Below `lg` every control here is a touch target, and the Inbox — the one
  // screen with a real mobile contract (DESIGN.md, The Phone Rule) — sits under
  // this bar. The visual size stays 34px on the desktop rail; `max-lg:` raises
  // the *target* to 44px on the widths where a finger is doing the pointing.
  // Measured at 390x844: five controls here were 34px, which made the "no
  // control under 44px on the Inbox" claim false.
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-canvas px-3 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="max-lg:size-11 lg:hidden"
      >
        <MenuIcon />
      </Button>

      {/* The app's single create control. It carries `?new` so the Tasks board
          opens its dialog on arrival, from whatever screen you pressed it on. */}
      <Button asChild variant="outline" className="max-lg:h-11">
        <Link to="/tasks" search={{ new: true }}>
          <Plus />
          New task
        </Link>
      </Button>

      {/* The rail is hidden below lg, so this is the only way into search there. */}
      <Button variant="ghost" size="icon" onClick={onOpenSearch} aria-label="Search" className="max-lg:size-11 lg:hidden">
        <Search />
      </Button>

      <div className="flex-1" />

      {running > 0 ? (
        <StatusPill tone="live" dot pulse className="hidden sm:inline-flex">
          {running} running
        </StatusPill>
      ) : null}

      <Button asChild variant="outline" size="icon" className="relative max-lg:size-11">
        <Link to="/inbox" aria-label={waiting > 0 ? `Inbox, ${waiting} waiting` : "Inbox"}>
          <Bell />
          {waiting > 0 ? (
            <span className="tnum absolute -top-1.5 -right-1.5 flex min-w-4.5 items-center justify-center rounded-full bg-gate px-1 text-[11px] leading-[18px] font-medium text-on-solid">
              {waiting}
            </span>
          ) : null}
        </Link>
      </Button>

      <Menu>
        <MenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More" className="max-lg:size-11">
            <MoreVertical />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>
            <BookOpen />
            <a href="https://github.com" target="_blank" rel="noreferrer">
              Docs
            </a>
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={onForgetToken} tone="danger">
            <LogOut />
            Forget this token
          </MenuItem>
        </MenuContent>
      </Menu>
    </header>
  );
}
