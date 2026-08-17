import { z } from "zod";
import { slugSchema } from "./project";
import { provenanceSchema, type Provenance } from "./provenance";

/**
 * A template is a chain of follow-up tasks (SPEC §9.4). Instantiating it
 * creates every card at once; step N+1 is blocked until step N is `done`,
 * which is what makes an approval gate a real stop rather than a label.
 */
export const templateStepSchema = z.object({
  name: z.string().min(1).max(300),
  /** Agent name, or the literal "human" for a step the operator owns. */
  agentName: z.string().min(1),
  prompt: z.string().default(""),
  approvalGate: z.boolean().default(false),
  /** Carry the previous step's attachments into this one. */
  attachmentsFromPrevious: z.boolean().default(true),
});
export type TemplateStep = z.infer<typeof templateStepSchema>;

export const createTemplateSchema = z.object({
  name: slugSchema,
  description: z.string().default(""),
  variables: z.array(z.string().min(1)).default([]),
  steps: z.array(templateStepSchema).min(1),
  provenance: provenanceSchema.optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const instantiateTemplateSchema = z.object({
  /** Values for the template's declared variables, e.g. { branchName: "…" }. */
  variables: z.record(z.string(), z.string()).default({}),
  /** Optional prefix so a chain is identifiable on the board. */
  titlePrefix: z.string().default(""),
  acknowledgePreflightWarnings: z.boolean().default(false),
});
export type InstantiateTemplateInput = Omit<
  z.infer<typeof instantiateTemplateSchema>,
  "acknowledgePreflightWarnings"
> & { acknowledgePreflightWarnings?: boolean };

export interface TaskTemplateDto {
  id: string;
  projectId: string;
  name: string;
  description: string;
  variables: string[];
  steps: TemplateStep[];
  provenance: Provenance;
}

/** `{{name}}` is the only interpolation form; unknown names are left intact. */
export function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) =>
    key in variables ? variables[key]! : match,
  );
}

/** Names a template declares but the caller did not supply. */
export function missingVariables(
  declared: string[],
  supplied: Record<string, string>,
): string[] {
  return declared.filter((name) => !(name in supplied) || supplied[name]!.trim() === "");
}
