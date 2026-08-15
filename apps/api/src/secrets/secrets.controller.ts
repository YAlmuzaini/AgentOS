import {
  type CreateSecretRefInput,
  createSecretRefSchema,
  type SecretRefDto,
} from "@agentos/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { SecretsService } from "./secrets.service";

/** References only — there is no endpoint that returns a secret's value. */
@Controller("projects/:projectId/secrets")
@UseGuards(OperatorGuard)
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get()
  list(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<SecretRefDto[]> {
    return this.secrets.list(projectId);
  }

  @Post()
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createSecretRefSchema)) body: CreateSecretRefInput,
  ): Promise<SecretRefDto> {
    return this.secrets.create(projectId, body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.secrets.remove(projectId, id);
  }
}
