import { z } from "zod";
import type { Provenance } from "./provenance";

export const RESOURCE_SLOT_KINDS = ["repo", "mcp", "environment", "folder", "deployment"] as const;

export const resourceSlotSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(RESOURCE_SLOT_KINDS),
  required: z.boolean(),
  description: z.string(),
});
export type ResourceSlot = z.infer<typeof resourceSlotSchema>;

export const resolveResourceSlotSchema = z.object({
  resourceType: z.enum(RESOURCE_SLOT_KINDS),
  resourceId: z.string().min(1),
});
export type ResolveResourceSlotInput = z.infer<typeof resolveResourceSlotSchema>;

export interface ResourceSlotDto extends ResourceSlot {
  projectId: string;
  blueprintSlug: string;
  resourceType: (typeof RESOURCE_SLOT_KINDS)[number] | null;
  resourceId: string | null;
  resolvedAt: string | null;
}

export interface CompanyBlueprint {
  slug: string;
  name: string;
  version: string;
  description: string;
  agentPacks: string[];
  exactAgents: string[];
  recommendedSkills: string[];
  templates: string[];
  defaultRunner: "local" | "cloud" | "auto";
  resourceSlots: ResourceSlot[];
  optionalCapabilities: string[];
  provenance: Provenance;
}

export interface BlueprintPreview {
  blueprint: CompanyBlueprint;
  create: string[];
  preserve: string[];
  warnings: string[];
}

export interface BlueprintInstallationDto {
  projectId: string;
  blueprintSlug: string;
  version: string;
  provenance: Provenance;
  installedAt: string;
  updatedAt: string;
}

export const applyBlueprintSchema = z.object({ acknowledgeWarnings: z.boolean().default(false) });
export type ApplyBlueprintInput = z.infer<typeof applyBlueprintSchema>;
