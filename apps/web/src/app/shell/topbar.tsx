import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, BookOpen, LogOut, Menu as MenuIcon, MoreVertical, Plus } from "lucide-react";
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
}: {
  onOpenNav: () => void;
  onForgetToken: () => void;
}): React.JSX.Element {
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    refetchInterval: 5000,
  });
  const inbox = useQuery({
    queryKey: ["inbox"],
    // Wrapped rather than passed by reference: `api.inbox` takes an optional
    // status filter, and React Query would hand it the query context.
    queryFn: () => api.inbox(),
    refetchInterval: 5000,
  });

  const running = (sessions.data ?? []).filter((session) => session.status === "running").length;
  const waiting = (inbox.data ?? []).filter((message) => message.status === "open").length;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-canvas px-3 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="lg:hidden"
      >
        <MenuIcon />
      </Button>

      {/* The app's single create control. It carries `?new` so the Tasks board
          opens its dialog on arrival, from whatever screen you pressed it on. */}
      <Button asChild variant="outline">
        <Link to="/tasks" search={{ new: true }}>
          <Plus />
          New task
        </Link>
      </Button>

      <div className="flex-1" />

      {running > 0 ? (
        <StatusPill tone="live" dot pulse className="hidden sm:inline-flex">
          {running} running
        </StatusPill>
      ) : null}

      <Button asChild variant="outline" size="icon" className="relative">
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
          <Button variant="outline" size="icon" aria-label="More">
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
