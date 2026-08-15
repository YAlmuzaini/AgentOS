import { type FileEntryDto, type WriteFileInput, writeFileSchema } from "@agentos/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { FilesService } from "./files.service";

/**
 * Operator file browser. These routes are the human's own access to the disk
 * and deliberately bypass the per-agent folder ACL; agents reach the same
 * storage only through their filesystem tools.
 */
@Controller("projects/:projectId/files")
@UseGuards(OperatorGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  list(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("path") path = "/",
  ): Promise<FileEntryDto[]> {
    return this.files.list(projectId, path);
  }

  @Get("content")
  read(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("path") path: string,
  ): Promise<{ path: string; content: string; mime: string }> {
    return this.files.read(projectId, path);
  }

  @Put("content")
  write(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(writeFileSchema)) body: WriteFileInput,
  ): Promise<FileEntryDto> {
    return this.files.write(projectId, body.path, body.content, body.mime);
  }

  @Delete("content")
  @HttpCode(204)
  remove(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("path") path: string,
  ): Promise<void> {
    return this.files.remove(projectId, path);
  }
}
