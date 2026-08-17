import { originalAgentosProvenance } from "../contracts/provenance";
import type { CompanyBlueprint, ResourceSlot } from "../contracts/company";

const primaryRepo: ResourceSlot = {
  key: "primary-repo",
  label: "Primary GitHub repository",
  kind: "repo",
  required: true,
  description: "The repository this fleet may read and, when deliberately granted, write.",
};
const executionEnvironment: ResourceSlot = {
  key: "execution-environment",
  label: "Execution environment",
  kind: "environment",
  required: true,
  description: "The explicit network posture applied to sessions.",
};
const docs: ResourceSlot = {
  key: "documentation",
  label: "Documentation source",
  kind: "mcp",
  required: false,
  description: "Optional documentation MCP; installing this profile does not grant it.",
};
const deployment: ResourceSlot = {
  key: "deployment-provider",
  label: "Deployment provider",
  kind: "deployment",
  required: false,
  description: "Optional deployment connection, resolved deliberately before release work.",
};
const provenance = originalAgentosProvenance("Original AgentOS single-operator company blueprint.");
const coreSkills = ["plan-mode", "commit-discipline", "no-fake-completion", "verification-loop", "root-cause-first", "search-first", "context-discipline", "pr-hygiene"];

function blueprint(input: Omit<CompanyBlueprint, "version" | "provenance">): CompanyBlueprint {
  return { ...input, version: "1.0.0", provenance };
}

export const COMPANY_BLUEPRINTS: CompanyBlueprint[] = [
  blueprint({ slug: "full-stack-product", name: "Full-stack product company", description: "A compact product, design, engineering, data, review, and release fleet.", agentPacks: ["core-engineering", "frontend-design", "data-rag", "devops-release", "product-content"], exactAgents: [], recommendedSkills: [...coreSkills, "accessible-interface", "design-system-discipline", "schema-change-safety", "security-review-checklist", "container-hygiene"], templates: ["compound-engineer-workflow", "bugfix-workflow"], defaultRunner: "auto", resourceSlots: [primaryRepo, executionEnvironment, docs, deployment], optionalCapabilities: ["Documentation MCP", "Deployment provider"] }),
  blueprint({ slug: "frontend-application", name: "Frontend application", description: "Frontend, visual design, testing, and the core review loop.", agentPacks: ["core-engineering", "frontend-design"], exactAgents: [], recommendedSkills: [...coreSkills, "accessible-interface", "design-system-discipline", "e2e-first"], templates: ["compound-engineer-workflow", "bugfix-workflow"], defaultRunner: "auto", resourceSlots: [primaryRepo, executionEnvironment, docs, deployment], optionalCapabilities: ["Browser-backed verification", "Deployment provider"] }),
  blueprint({ slug: "backend-api", name: "Backend/API service", description: "Backend delivery with schema, security, testing, and release specialists.", agentPacks: ["core-engineering", "data-rag", "devops-release"], exactAgents: [], recommendedSkills: [...coreSkills, "schema-change-safety", "security-review-checklist", "container-hygiene"], templates: ["compound-engineer-workflow", "bugfix-workflow"], defaultRunner: "auto", resourceSlots: [primaryRepo, executionEnvironment, docs, deployment], optionalCapabilities: ["Documentation MCP", "Deployment provider"] }),
  blueprint({ slug: "data-rag", name: "Data/RAG project", description: "Retrieval, ingestion, evaluation, security, and data architecture roles.", agentPacks: ["core-engineering", "data-rag", "research-docs"], exactAgents: [], recommendedSkills: [...coreSkills, "rag-architecture", "retrieval-evaluation", "rag-security", "document-ingestion-discipline", "schema-change-safety"], templates: ["compound-engineer-workflow"], defaultRunner: "auto", resourceSlots: [primaryRepo, executionEnvironment, docs], optionalCapabilities: ["Vector-store MCP", "Corpus folder"] }),
  blueprint({ slug: "devops-infrastructure", name: "DevOps/infrastructure project", description: "Infrastructure planning, dependency review, release, and verification.", agentPacks: ["core-engineering", "devops-release"], exactAgents: [], recommendedSkills: [...coreSkills, "container-hygiene", "security-review-checklist"], templates: ["compound-engineer-workflow", "bugfix-workflow"], defaultRunner: "cloud", resourceSlots: [primaryRepo, executionEnvironment, deployment], optionalCapabilities: ["Deployment provider"] }),
  blueprint({ slug: "mobile-application", name: "Mobile application", description: "Mobile implementation, product design, testing, and core review.", agentPacks: ["core-engineering", "mobile", "product-content"], exactAgents: ["ui-designer"], recommendedSkills: [...coreSkills, "accessible-interface", "design-system-discipline", "e2e-first"], templates: ["compound-engineer-workflow", "bugfix-workflow"], defaultRunner: "auto", resourceSlots: [primaryRepo, executionEnvironment, docs, deployment], optionalCapabilities: ["Device test environment", "App-store deployment"] }),
  blueprint({ slug: "minimal-core", name: "Minimal/core engineering", description: "The smallest fleet that can plan, implement, review, verify, and hand work back.", agentPacks: ["core-engineering"], exactAgents: [], recommendedSkills: coreSkills, templates: ["compound-engineer-workflow", "bugfix-workflow"], defaultRunner: "local", resourceSlots: [primaryRepo, executionEnvironment], optionalCapabilities: [] }),
];

export function findCompanyBlueprint(slug: string): CompanyBlueprint | undefined {
  return COMPANY_BLUEPRINTS.find((entry) => entry.slug === slug);
}
