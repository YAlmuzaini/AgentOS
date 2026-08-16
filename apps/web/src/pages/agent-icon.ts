import {
  BarChart3,
  Bot,
  BookOpen,
  Bug,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Gauge,
  Hammer,
  LifeBuoy,
  type LucideIcon,
  Network,
  PenLine,
  Scale,
  Search,
  Shield,
  ShieldCheck,
} from "lucide-react";

/**
 * A glyph for an agent.
 *
 * The reference gives every agent card its own icon (design-refs/agents/07.jpg)
 * and that is most of why a grid of twelve of them stays scannable: the eye
 * finds the shape before it reads the name. AgentOS has no icon field on an
 * agent and is not getting one — a stored icon is a thing to maintain and to
 * get wrong. So the glyph is read off the slug the operator already chose,
 * which is stable, needs no migration, and is right for the built-ins by
 * construction because they are named after what they do.
 *
 * Order matters: the first match wins, so the more specific slug fragment is
 * listed above the more general one ("plan-risk" before "plan").
 */
const BY_KEYWORD: Array<[RegExp, LucideIcon]> = [
  [/risk|guard|scope/, Shield],
  [/secur|polic|complian/, ShieldCheck],
  [/coordinat|orchestrat|route|dispatch/, Network],
  [/review|approv|critic/, ClipboardCheck],
  [/plan|spec|design/, ClipboardList],
  [/implement|execut|build|fix|refactor/, Hammer],
  [/test|qa|e2e|verif/, FlaskConical],
  [/diagnos|debug|trace|incident/, Bug],
  [/research|explor|search|discover/, Search],
  [/librar|doc|knowledge|memo/, BookOpen],
  [/support|help|success/, LifeBuoy],
  [/content|writ|copy|market|social|linkedin/, PenLine],
  [/feasib|estimat|scor|weigh/, Scale],
  [/analy|metric|report|data|revenue|finance/, BarChart3],
  [/perf|latenc|benchmark|monitor/, Gauge],
];

export function agentIcon(agent: { name: string; title: string }): LucideIcon {
  const subject = `${agent.name} ${agent.title}`.toLowerCase();
  for (const [pattern, icon] of BY_KEYWORD) {
    if (pattern.test(subject)) {
      return icon;
    }
  }
  return Bot;
}
