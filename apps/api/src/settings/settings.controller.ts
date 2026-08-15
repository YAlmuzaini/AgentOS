import { type SettingsDto, type UpdateSettingsInput, updateSettingsSchema } from "@agentos/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { SettingsService } from "./settings.service";

@Controller("projects/:projectId/settings")
@UseGuards(OperatorGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<SettingsDto> {
    return this.settings.get(projectId);
  }

  @Put()
  update(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(updateSettingsSchema)) body: UpdateSettingsInput,
  ): Promise<SettingsDto> {
    return this.settings.update(projectId, body);
  }
}
