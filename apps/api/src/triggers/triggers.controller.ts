import {
  type CreateTriggerInput,
  createTriggerSchema,
  type TriggerDto,
  type TriggerFireDto,
  type TriggerSecretDto,
} from "@agentos/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./webhook-signature";
import { TriggersService } from "./triggers.service";

@Controller("projects/:projectId/triggers")
@UseGuards(OperatorGuard)
export class TriggersController {
  constructor(private readonly triggers: TriggersService) {}

  @Get()
  list(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<TriggerDto[]> {
    return this.triggers.list(projectId);
  }

  @Post()
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(createTriggerSchema)) body: CreateTriggerInput,
  ): Promise<TriggerSecretDto> {
    return this.triggers.create(projectId, body);
  }

  /** Creates the SPEC §14 example triggers and shows their keys once. */
  @Post("install-examples")
  installExamples(
    @Param("projectId", ParseUUIDPipe) projectId: string,
  ): Promise<TriggerSecretDto[]> {
    return this.triggers.installExamples(projectId);
  }

  @Post(":id/rotate-secret")
  rotate(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TriggerSecretDto> {
    return this.triggers.rotateSecret(projectId, id);
  }

  @Get(":id/fires")
  fires(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TriggerFireDto[]> {
    return this.triggers.fires(projectId, id);
  }

  @Delete(":id")
  remove(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.triggers.remove(projectId, id);
  }
}

/**
 * The public receiver. Deliberately outside the operator guard: it is
 * authenticated by the trigger's own signature, over the raw body, and by
 * nothing else.
 */
@Controller("hooks")
export class WebhookController {
  constructor(private readonly triggers: TriggersService) {}

  @Post(":triggerId")
  receive(
    @Param("triggerId", ParseUUIDPipe) triggerId: string,
    @Req() request: Request & { rawBody?: Buffer },
  ): Promise<{ taskId: string }> {
    return this.triggers.handleDelivery({
      triggerId,
      rawBody: request.rawBody?.toString("utf8") ?? "",
      signature: header(request, SIGNATURE_HEADER),
      timestamp: header(request, TIMESTAMP_HEADER),
    });
  }
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
