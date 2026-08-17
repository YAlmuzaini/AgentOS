/**
 * The category an agent, skill or MCP connection belongs to.
 *
 * This exists so the operator can answer one question quickly — *who is
 * responsible for this task?* — without reading thirty role prompts. A flat
 * list is fine at fourteen agents and useless at forty.
 *
 * The taxonomy is adapted from how the public skill directories carve the
 * space up (their twenty-odd categories, ranked by how many skills sit in
 * each), collapsed to the divisions that mean something inside a build rather
 * than inside a marketplace. `Cloud Infrastructure` and `Deployment & DevOps`
 * are one job here; `E-commerce` and `Social Media` are both `content` or
 * `operations` depending on who does the work.
 *
 * `general` is the fallback and the default for a row written before this
 * column existed. It is a real category, not a null — an uncategorised agent
 * still has to appear somewhere the operator will look.
 */
export const CATEGORIES = [
  "general",
  "planning",
  "engineering",
  "review",
  "testing",
  "security",
  "devops",
  "data",
  "frontend",
  "mobile",
  "research",
  "operations",
  "content",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Display names. The UI must never render the raw slug. */
export const CATEGORY_LABELS: Record<Category, string> = {
  general: "General",
  planning: "Planning & specification",
  engineering: "Engineering",
  review: "Review & quality",
  testing: "Testing & QA",
  security: "Security",
  devops: "DevOps & delivery",
  data: "Data & databases",
  frontend: "Frontend & design",
  mobile: "Mobile",
  research: "Research & documentation",
  operations: "Support & operations",
  content: "Content & marketing",
};

/** One line saying what belongs here, for the filter UI's tooltip. */
export const CATEGORY_HINTS: Record<Category, string> = {
  general: "Work that does not belong to one discipline.",
  planning: "Turning an intent into a spec, a plan, or a product decision.",
  engineering: "Writing, changing, and debugging application code.",
  review: "Reading someone else's work and reporting on it. Never fixing it.",
  testing: "Proving the change behaves, and keeping the proof honest.",
  security: "Vulnerabilities, secrets, dependencies, and blast radius.",
  devops: "Containers, pipelines, infrastructure, and releases.",
  data: "Schemas, migrations, queries, and analysis.",
  frontend: "Interfaces, components, accessibility, and the visual system.",
  mobile: "iOS, Android, and cross-platform app work.",
  research: "Finding out what is true, and writing it down for the next agent.",
  operations: "Inbound work from humans: support, triage, routing.",
  content: "Writing meant for an audience outside the team.",
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
