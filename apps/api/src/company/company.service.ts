import {
  agents,
  blueprintInstallations,
  type Database,
  environments,
  mcpConnections,
  projectResourceSlots,
  projectSettings,
  repos,
  skills,
  taskTemplates,
} from "@agentos/db";
import {
  type ApplyBlueprintInput,
  type BlueprintInstallationDto,
  type BlueprintPreview,
  builtInRoleInstalls,
  COMPANY_BLUEPRINTS,
  type CompanyBlueprint,
  findCompanyBlueprint,
  findPack,
  type ResolveResourceSlotInput,
  type ResourceSlotDto,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { AgentsService } from "../agents/agents.service";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";
import { CatalogService } from "../resources/catalog.service";
import { TemplatesService } from "../templates/templates.service";

@Injectable()
export class CompanyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly agentsService: AgentsService,
    private readonly catalog: CatalogService,
    private readonly templates: TemplatesService,
  ) {}

  list(): CompanyBlueprint[] {
    return COMPANY_BLUEPRINTS;
  }

  async preview(projectId: string, slug: string): Promise<BlueprintPreview> {
    await this.projects.require(projectId);
    const blueprint = requireBlueprint(slug);
    const roleNames = rolesFor(blueprint);
    const [agentRows, skillRows, templateRows, settings, slotRows] = await Promise.all([
      this.db.select({ name: agents.name }).from(agents).where(eq(agents.projectId, projectId)),
      this.db.select({ slug: skills.slug }).from(skills).where(eq(skills.projectId, projectId)),
      this.db.select({ name: taskTemplates.name }).from(taskTemplates).where(eq(taskTemplates.projectId, projectId)),
      this.db.query.projectSettings.findFirst({ where: eq(projectSettings.projectId, projectId) }),
      this.db.select().from(projectResourceSlots).where(eq(projectResourceSlots.projectId, projectId)),
    ]);
    const existing = new Set([
      ...agentRows.map((row) => `agent:${row.name}`),
      ...skillRows.map((row) => `skill:${row.slug}`),
      ...templateRows.map((row) => `workflow:${row.name}`),
    ]);
    const wanted = [
      ...roleNames.map((name) => `agent:${name}`),
      ...skillsFor(blueprint, roleNames).map((name) => `skill:${name}`),
      ...blueprint.templates.map((name) => `workflow:${name}`),
    ];
    return {
      blueprint,
      create: wanted.filter((entry) => !existing.has(entry)),
      preserve: wanted.filter((entry) => existing.has(entry)),
      warnings: [
        "The profile creates inert catalog rows only; it grants no repository, credential, MCP, filesystem, or network access.",
        ...(settings ? ["Existing project runner settings will be preserved."] : []),
        ...blueprint.optionalCapabilities.map((item) => `${item} remains optional and unresolved.`),
        ...slotCollisions(blueprint, slotRows),
      ],
    };
  }

  async apply(projectId: string, slug: string, input: ApplyBlueprintInput): Promise<BlueprintInstallationDto> {
    const preview = await this.preview(projectId, slug);
    if (preview.warnings.length > 0 && !input.acknowledgeWarnings) {
      throw new BadRequestException({ message: "blueprint warnings require acknowledgement", preview });
    }
    const blueprint = preview.blueprint;
    const roleNames = rolesFor(blueprint);
    const [existingAgents, existingSkills] = await Promise.all([
      this.db.select({ name: agents.name }).from(agents).where(eq(agents.projectId, projectId)),
      this.db.select({ slug: skills.slug }).from(skills).where(eq(skills.projectId, projectId)),
    ]);
    const agentNames = new Set(existingAgents.map((row) => row.name));
    const skillSlugs = new Set(existingSkills.map((row) => row.slug));
    await this.catalog.installBuiltInSkills(
      projectId,
      skillsFor(blueprint, roleNames).filter((slug) => !skillSlugs.has(slug)),
    );
    await this.agentsService.installBuiltIns(projectId, roleNames.filter((name) => !agentNames.has(name)));
    for (const pack of blueprint.agentPacks) {
      await this.agentsService.recordPackInstallation(projectId, pack);
    }
    // Every template the profile names, not only the missing ones. The
    // installer is idempotent and its `setWhere` protects operator-authored
    // rows, and filtering here hid existing rows from the legacy-adoption pass
    // — so the one screen an upgrading operator actually uses could never
    // adopt the pre-0023 built-in it was meant to correct.
    await this.templates.installBuiltIns(projectId, blueprint.templates);

    await this.db
      .insert(projectSettings)
      .values({ projectId, defaultRunner: blueprint.defaultRunner })
      .onConflictDoNothing({ target: projectSettings.projectId });
    // Slot-key collision semantics, stated once and enforced here:
    //
    //   1. A slot row belongs to the blueprint that first declared its key.
    //      Label, description and kind are that blueprint's, and a *resolved*
    //      resource is never touched — silently repointing a resolved
    //      production repository because a second profile reused the key
    //      `primary-repo` is exactly the kind of quiet change this product
    //      must not make.
    //   2. The one thing that does propagate is strictness. If a later profile
    //      declares an existing optional slot as required, the row becomes
    //      required: dropping a stricter requirement would let preflight pass
    //      a fleet the new profile says is not ready.
    //
    // The operator is told about every collision in the preview warnings.
    for (const slot of blueprint.resourceSlots) {
      const [inserted] = await this.db
        .insert(projectResourceSlots)
        .values({ projectId, blueprintSlug: blueprint.slug, slotKey: slot.key, definition: slot })
        .onConflictDoNothing({ target: [projectResourceSlots.projectId, projectResourceSlots.slotKey] })
        .returning();
      if (inserted || !slot.required) continue;
      const existing = await this.db.query.projectResourceSlots.findFirst({
        where: and(eq(projectResourceSlots.projectId, projectId), eq(projectResourceSlots.slotKey, slot.key)),
      });
      if (!existing || existing.definition.required) continue;
      await this.db
        .update(projectResourceSlots)
        .set({ definition: { ...existing.definition, required: true } })
        .where(eq(projectResourceSlots.id, existing.id));
    }
    const [row] = await this.db
      .insert(blueprintInstallations)
      .values({ projectId, blueprintSlug: blueprint.slug, version: blueprint.version, provenance: blueprint.provenance })
      .onConflictDoUpdate({
        target: [blueprintInstallations.projectId, blueprintInstallations.blueprintSlug],
        set: { version: blueprint.version, provenance: blueprint.provenance, updatedAt: new Date() },
      })
      .returning();
    return installationDto(row!);
  }

  async installations(projectId: string): Promise<BlueprintInstallationDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db.select().from(blueprintInstallations).where(eq(blueprintInstallations.projectId, projectId));
    return rows.map(installationDto);
  }

  async slots(projectId: string): Promise<ResourceSlotDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db.select().from(projectResourceSlots).where(eq(projectResourceSlots.projectId, projectId));
    return rows.map((row) => ({
      ...row.definition,
      projectId: row.projectId,
      blueprintSlug: row.blueprintSlug,
      resourceType: row.resourceType as ResourceSlotDto["resourceType"],
      resourceId: row.resourceId,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }));
  }

  async resolveSlot(projectId: string, key: string, input: ResolveResourceSlotInput): Promise<ResourceSlotDto> {
    const slot = await this.db.query.projectResourceSlots.findFirst({
      where: and(eq(projectResourceSlots.projectId, projectId), eq(projectResourceSlots.slotKey, key)),
    });
    if (!slot) throw new NotFoundException(`resource slot ${key} not found in this project`);
    if (slot.definition.kind !== input.resourceType) {
      throw new BadRequestException(`slot ${key} requires ${slot.definition.kind}, not ${input.resourceType}`);
    }
    await this.requireResource(projectId, input.resourceType, input.resourceId);
    const [row] = await this.db
      .update(projectResourceSlots)
      .set({ resourceType: input.resourceType, resourceId: input.resourceId, resolvedAt: new Date() })
      .where(eq(projectResourceSlots.id, slot.id))
      .returning();
    return (await this.slots(projectId)).find((candidate) => candidate.key === row!.slotKey)!;
  }

  private async requireResource(projectId: string, type: ResolveResourceSlotInput["resourceType"], id: string): Promise<void> {
    if (type === "folder") return;
    const table = type === "repo" ? repos : type === "environment" ? environments : mcpConnections;
    const row = await this.db.select({ id: table.id }).from(table).where(and(eq(table.projectId, projectId), eq(table.id, id)));
    if (row.length === 0) throw new NotFoundException(`${type} resource ${id} not found in this project`);
  }
}

function requireBlueprint(slug: string): CompanyBlueprint {
  const blueprint = findCompanyBlueprint(slug);
  if (!blueprint) throw new NotFoundException(`company blueprint ${slug} not found`);
  return blueprint;
}

/** Names every slot key this profile would collide with, and what survives. */
function slotCollisions(
  blueprint: CompanyBlueprint,
  existing: Array<typeof projectResourceSlots.$inferSelect>,
): string[] {
  return blueprint.resourceSlots.flatMap((slot) => {
    const clash = existing.find((row) => row.slotKey === slot.key);
    if (!clash || clash.blueprintSlug === blueprint.slug) return [];
    const resolved = clash.resourceId
      ? " Its already-resolved resource is kept exactly as it is."
      : "";
    const stricter = slot.required && !clash.definition.required
      ? " It becomes required, because this profile requires it."
      : "";
    return [
      `Resource slot "${slot.key}" already belongs to profile "${clash.blueprintSlug}". ` +
        `That profile's definition is kept.${resolved}${stricter}`,
    ];
  });
}

function rolesFor(blueprint: CompanyBlueprint): string[] {
  return [...new Set([...blueprint.agentPacks.flatMap((slug) => findPack(slug)?.roles ?? []), ...blueprint.exactAgents])];
}

function skillsFor(blueprint: CompanyBlueprint, roleNames: string[]): string[] {
  const roles = builtInRoleInstalls().filter((role) => roleNames.includes(role.name));
  return [...new Set([...blueprint.recommendedSkills, ...roles.flatMap((role) => role.recommendedSkills)])];
}

function installationDto(row: typeof blueprintInstallations.$inferSelect): BlueprintInstallationDto {
  return { projectId: row.projectId, blueprintSlug: row.blueprintSlug, version: row.version, provenance: row.provenance, installedAt: row.installedAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
