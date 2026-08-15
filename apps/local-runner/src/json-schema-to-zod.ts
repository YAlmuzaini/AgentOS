import { z } from "zod";

/**
 * Converts the control plane's JSON Schema tool definitions into the Zod shape
 * the Claude Agent SDK's `tool()` wants.
 *
 * Deliberately narrow: it covers exactly the shapes `apps/api/src/runner/tools.ts`
 * emits — flat objects of strings, numbers, booleans, enums, and string arrays.
 * Anything it does not recognise becomes `z.unknown()`, which keeps the tool
 * callable rather than failing the whole session over a schema detail. The
 * control plane validates tool input anyway; this schema is what the *model*
 * reads, so being slightly permissive here costs nothing.
 */
export function toZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[] | undefined) ?? []);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, property] of Object.entries(properties)) {
    const base = describe(toZodType(property), property.description);
    shape[key] = required.has(key) ? base : base.optional();
  }
  return shape;
}

function toZodType(property: Record<string, unknown>): z.ZodTypeAny {
  const values = property.enum as unknown[] | undefined;
  if (Array.isArray(values) && values.length > 0 && values.every((v) => typeof v === "string")) {
    return z.enum(values as [string, ...string[]]);
  }

  switch (property.type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(toZodType((property.items as Record<string, unknown>) ?? {}));
    case "object":
      return z.object(toZodShape(property));
    default:
      return z.unknown();
  }
}

function describe(type: z.ZodTypeAny, description: unknown): z.ZodTypeAny {
  return typeof description === "string" ? type.describe(description) : type;
}
