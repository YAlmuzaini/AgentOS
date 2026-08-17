/**
 * Catalogue packs: a named subset of roles worth installing together.
 *
 * Thirty-seven agents is a good library and a bad starting screen. A pack is
 * how an operator says "this project is a frontend" and gets six roles instead
 * of all of them — without losing the rest, which stay one install away.
 *
 * A pack is **not** a permission. Installing one writes agent rows with no
 * repos, no MCP connections, no folders, no collaborators beyond what the role
 * itself declares, and no network. "Available by default" means visible in the
 * catalogue; every grant is still a separate, deliberate act (SPEC §5.1).
 *
 * Packs overlap on purpose. `core-engineering` appears inside most real
 * projects, and installing two packs that share a role installs it once —
 * installation is keyed by name and idempotent.
 */

import type { Category } from "./categories";

export interface CatalogPack {
  slug: string;
  name: string;
  description: string;
  /** Which filter chip this pack lines up with, for the UI. */
  category: Category;
  /** Role names, resolved against the shipped catalogue at install time. */
  roles: string[];
}

export const CATALOG_PACKS: CatalogPack[] = [
  {
    slug: "core-engineering",
    name: "Core engineering",
    category: "engineering",
    description:
      "The roles the built-in templates dispatch to, plus the specialists a code review needs. Install this first: without it the compound feature workflow has steps it cannot run.",
    roles: [
      "default",
      "spec",
      "plan",
      "review-coordinator",
      "feasibility",
      "scope-guardian",
      "coherence",
      "plan-risk",
      "senior-dev",
      "implementation-plan-executioner",
      "code-review-coordinator",
      "security-reviewer",
      "test-auditor",
      "simplifier",
      "performance-reviewer",
      "debugger",
      "verifier",
      "librarian",
    ],
  },
  {
    slug: "frontend-design",
    name: "Frontend & design",
    category: "frontend",
    description:
      "Interface implementation and the visual system that governs it. Pair with core engineering; on its own it can build a screen but not review or ship one.",
    roles: ["frontend-engineer", "ui-designer", "test-engineer"],
  },
  {
    slug: "data-rag",
    name: "Data, databases & RAG",
    category: "data",
    description:
      "Schema and migration work, analysis, and retrieval-augmented generation design. The RAG architect designs and reviews; it is not granted a vector store or a corpus by installing this.",
    roles: ["db-architect", "data-analyst", "rag-engineering-architect"],
  },
  {
    slug: "devops-release",
    name: "DevOps & release",
    category: "devops",
    description:
      "Containers, pipelines, and getting a reviewed branch out of the door with a rollback written down.",
    roles: ["devops-engineer", "release-manager", "dependency-auditor"],
  },
  {
    slug: "research-docs",
    name: "Research & documentation",
    category: "research",
    description:
      "Finding out what is true and writing it down. Useful in every project and required in none, which is why it is its own pack.",
    roles: ["researcher", "docs-writer", "librarian"],
  },
  {
    slug: "product-content",
    name: "Product & content",
    category: "content",
    description:
      "Deciding what to build before a spec exists, and writing the outward-facing words afterwards.",
    roles: ["product-strategist", "content-writer", "linkedin-content"],
  },
  {
    slug: "operations-support",
    name: "Operations & support",
    category: "operations",
    description:
      "Inbound work from humans. The support agent is the one role in the catalogue that must never hold a repository — grant it a support connection and nothing else.",
    roles: ["customer-support", "triage", "diagnostic"],
  },
  {
    slug: "mobile",
    name: "Mobile",
    category: "mobile",
    description: "Application work for iOS, Android, and cross-platform codebases.",
    roles: ["mobile-engineer", "test-engineer"],
  },
];

export function findPack(slug: string): CatalogPack | undefined {
  return CATALOG_PACKS.find((pack) => pack.slug === slug);
}
