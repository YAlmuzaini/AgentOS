import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case");

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}
