import { z } from "zod";
import { hasUrlCredential } from "./url-safety";

export const PROVENANCE_RELATIONSHIPS = ["original", "imported", "adapted", "inspired"] as const;
export type ProvenanceRelationship = (typeof PROVENANCE_RELATIONSHIPS)[number];

/**
 * A provenance URL, held to the same rule as an MCP endpoint.
 *
 * These are stored verbatim, returned by the API and rendered as clickable
 * links on the agent, skill and workflow screens, so a credential in one is a
 * credential in the database and on the operator's screen — the same failure
 * the MCP endpoint rule exists to stop, on a field nobody thought of as an
 * endpoint. Userinfo and credential-shaped query and fragment parameters are
 * refused; see `url-safety.ts` for what that cannot catch.
 */
const provenanceUrl = z
  .string()
  .url()
  .refine((value) => !hasUrlCredential(value), {
    message:
      "a provenance link is stored and rendered verbatim, so it may not carry a credential in " +
      "its userinfo or query",
  });

/** Traceable origin metadata. It never contains credentials or fetched content. */
export const provenanceSchema = z.object({
  relationship: z.enum(PROVENANCE_RELATIONSHIPS),
  canonicalUrl: provenanceUrl.nullable().default(null),
  marketplaceUrl: provenanceUrl.nullable().default(null),
  repositoryUrl: provenanceUrl.nullable().default(null),
  repositoryPath: z.string().nullable().default(null),
  version: z.string().nullable().default(null),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i).nullable().default(null),
  license: z.string().nullable().default(null),
  licenseUrl: provenanceUrl.nullable().default(null),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/i).nullable().default(null),
  importedAt: z.string().datetime().nullable().default(null),
  lastUpstreamCheckAt: z.string().datetime().nullable().default(null),
  notes: z.string().max(4000).nullable().default(null),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const ORIGINAL_PROVENANCE: Provenance = provenanceSchema.parse({
  relationship: "original",
});

export const originalAgentosProvenance = (notes?: string): Provenance =>
  provenanceSchema.parse({ relationship: "original", notes: notes ?? "Original AgentOS content." });
