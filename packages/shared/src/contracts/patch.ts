import { z } from "zod";

/**
 * The update schema for a create schema — a real partial, defaults and all.
 *
 * `create.partial()` alone is a trap. Zod applies a field's `.default()`
 * whenever the key is absent, and `.partial()` only makes the key optional, so
 * an update body that omits a defaulted field arrives at the service carrying
 * that field's *default* rather than nothing at all. On `createAgentSchema`
 * that is ten fields: `PUT /agents/:id` with `{ skillIds }` alone came back
 * with the description blanked, the category reset to `general`, and every
 * grant — MCP connections, repo access, filesystem, collaboration list —
 * emptied, because "absent" and "give me the default" are the same input.
 *
 * The web forms send every field, so this never fired in the UI. The CLI, the
 * YAML reconciler and any direct API call are exactly the callers that send one
 * key, which is where it bites.
 *
 * Unwrapping the `.default()` first makes an absent key stay absent: the
 * service's `set` spread then leaves that column alone.
 */
type Unwrapped<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;

export function patchSchema<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): z.ZodObject<{ [K in keyof Shape]: z.ZodOptional<Unwrapped<Shape[K]>> }> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      const bare: z.ZodTypeAny =
        field instanceof z.ZodDefault ? (field.def.innerType as z.ZodTypeAny) : (field as z.ZodTypeAny);
      return [key, bare.optional()];
    }),
  );
  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof Shape]: z.ZodOptional<Unwrapped<Shape[K]>>;
  }>;
}
