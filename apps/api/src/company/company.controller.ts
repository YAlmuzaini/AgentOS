import {
  type ApplyBlueprintInput,
  applyBlueprintSchema,
  type BlueprintInstallationDto,
  type BlueprintPreview,
  type CompanyBlueprint,
  type ResolveResourceSlotInput,
  resolveResourceSlotSchema,
  type ResourceSlotDto,
} from "@agentos/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { CompanyService } from "./company.service";

@Controller()
@UseGuards(OperatorGuard)
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get("company-blueprints")
  list(): CompanyBlueprint[] { return this.company.list(); }

  @Get("projects/:projectId/company-blueprints/:slug/preview")
  preview(@Param("projectId", ParseUUIDPipe) projectId: string, @Param("slug") slug: string): Promise<BlueprintPreview> {
    return this.company.preview(projectId, slug);
  }

  @Post("projects/:projectId/company-blueprints/:slug/apply")
  apply(@Param("projectId", ParseUUIDPipe) projectId: string, @Param("slug") slug: string, @Body(new ZodBody(applyBlueprintSchema)) body: ApplyBlueprintInput): Promise<BlueprintInstallationDto> {
    return this.company.apply(projectId, slug, body);
  }

  @Get("projects/:projectId/company-blueprints")
  installations(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<BlueprintInstallationDto[]> {
    return this.company.installations(projectId);
  }

  @Get("projects/:projectId/resource-slots")
  slots(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<ResourceSlotDto[]> {
    return this.company.slots(projectId);
  }

  @Put("projects/:projectId/resource-slots/:key")
  resolve(@Param("projectId", ParseUUIDPipe) projectId: string, @Param("key") key: string, @Body(new ZodBody(resolveResourceSlotSchema)) body: ResolveResourceSlotInput): Promise<ResourceSlotDto> {
    return this.company.resolveSlot(projectId, key, body);
  }
}
