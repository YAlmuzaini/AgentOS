import {
  type FileEntryDto,
  mimeForPath,
  type WriteFileInput,
  writeFileSchema,
} from "@agentos/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { OperatorGuard } from "../auth/operator.guard";
import { ZodBody } from "../common/zod-body.pipe";
import { FilesService } from "./files.service";

/**
 * A ceiling on one upload. The agent filesystem holds specs, plans, reports
 * and the occasional screenshot; anything larger is a different product.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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

  /**
   * The id behind a path. Attachments are stored as ids, and everything the
   * operator touches is a path, so one of the two has to be looked up.
   */
  @Get("id")
  fileId(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("path") path: string,
  ): Promise<{ id: string; path: string }> {
    return this.files.idForPath(projectId, path);
  }

  @Put("content")
  write(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodBody(writeFileSchema)) body: WriteFileInput,
  ): Promise<FileEntryDto> {
    return this.files.write(projectId, body.path, body.content, body.mime);
  }

  /**
   * The bytes, as a download (SPEC §7, §18).
   *
   * Streamed through the API rather than handed out as a signed storage URL:
   * the object store credential is the one thing on this box that must never
   * reach a browser, and a single operator is not a bandwidth problem.
   */
  @Get("download")
  async download(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("path") path: string,
    @Query("disposition") disposition = "attachment",
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.files.readBytes(projectId, path);
    // A header value is not a place for whatever the filename happens to
    // contain: quotes end the parameter early and a newline starts a header.
    const name = (file.path.split("/").pop() ?? "download").replace(/[^\w.\- ]+/g, "_");
    response.setHeader("content-type", file.mime || "application/octet-stream");
    response.setHeader("content-length", String(file.bytes.byteLength));
    response.setHeader(
      "content-disposition",
      `${disposition === "inline" ? "inline" : "attachment"}; filename="${name}"`,
    );
    response.end(file.bytes);
  }

  /**
   * An upload from the operator's own machine. The body is the file: no
   * multipart, because there is exactly one file and its path is the query.
   */
  @Post("upload")
  async upload(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("path") path: string,
    @Req() request: Request,
  ): Promise<FileEntryDto> {
    const declared = String(request.headers["content-type"] ?? "");
    const bytes = await readBody(request);
    return this.files.writeBytes(projectId, path, bytes, mimeForPath(path, declared || undefined));
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

/**
 * Collects the request body, refusing anything over the ceiling.
 *
 * Counted as it arrives rather than after: a body that is too large should
 * cost the bytes already read and nothing more.
 */
async function readBody(request: Request): Promise<Buffer> {
  // `rawBody: true` in `main.ts` gives parsed content types a buffer already;
  // binary ones arrive as an unread stream.
  const raw = (request as Request & { rawBody?: Buffer }).rawBody;
  if (raw) {
    assertSize(raw.byteLength);
    return raw;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    assertSize(size);
    chunks.push(buffer);
  }
  if (size === 0) {
    throw new BadRequestException("the request body was empty");
  }
  return Buffer.concat(chunks);
}

function assertSize(size: number): void {
  if (size > MAX_UPLOAD_BYTES) {
    throw new BadRequestException(
      `uploads are limited to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
    );
  }
}
