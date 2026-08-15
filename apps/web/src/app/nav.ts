import {
  Blocks,
  Bot,
  CalendarClock,
  Folder,
  FolderGit2,
  GitBranch,
  History,
  Inbox,
  KeyRound,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Target,
  Terminal,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** Groups render their caption; the lead group is deliberately unlabelled. */
  label: string | null;
  items: NavItem[];
}

/**
 * SPEC §18 sidebar, grouped by what the operator is actually doing rather than
 * by which service owns the row. The first group is the work itself and carries
 * no caption — it is where the app opens and where it returns.
 */
export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { to: "/tasks", label: "Tasks", icon: SquareKanban },
      { to: "/goals", label: "Goals", icon: Target },
      { to: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "Agents",
    items: [
      { to: "/agents", label: "Agents", icon: Bot },
      { to: "/templates", label: "Templates", icon: FolderGit2 },
      { to: "/skills", label: "Skills", icon: Sparkles },
      { to: "/sessions", label: "Sessions", icon: Terminal },
      { to: "/activity", label: "Activity", icon: History },
    ],
  },
  {
    label: "Resources",
    items: [
      { to: "/repos", label: "Repos", icon: GitBranch },
      { to: "/files", label: "Files", icon: Folder },
      { to: "/mcps", label: "MCPs", icon: Blocks },
    ],
  },
  {
    label: "Policy",
    items: [
      { to: "/environment", label: "Environment", icon: ShieldCheck },
      { to: "/secrets", label: "Secrets", icon: KeyRound },
      { to: "/triggers", label: "Triggers", icon: Webhook },
      { to: "/automations", label: "Automations", icon: CalendarClock },
    ],
  },
];
