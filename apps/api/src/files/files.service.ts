import { type Database, fileObjects } from "@agentos/db";
import {
  authorizeFs,
  type FileEntryDto,
  type FilesystemGrant,
  type FsOperation,
  normalisePath,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, like } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ObjectStorage } from "./storage";

/** Marker object that makes an empty folder visible in a listing. */
const FOLDER_MARKER = ".keep";

export interface AgentFsCaller {
  agentSlug: string;
  grants: FilesystemGrant[];
}

/**
 * The persistent agent filesystem (SPEC §7).
 *
 * Sessions are ephemeral, so this is where anything that must outlive a
 * container goes. Every agent-initiated call is authorised here against the
 * agent's folder grants; the operator's own browser calls bypass the ACL
 * because the disk is theirs.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: ObjectStorage,
  ) {}

  /* ── Operator surface (no agent ACL) ────────────────────────────────── */

  async list(projectId: string, prefix = "/"): Promise<FileEntryDto[]> {
    const normalised = normalisePath(prefix.endsWith("/") ? prefix : `${prefix}/`);
    if (normalised === null) {
      throw new BadRequestException("invalid path");
    }
    const rows = await this.db
      .select()
      .from(fileObjects)
      .where(and(eq(fileObjects.projectId, projectId), like(fileObjects.path, `${normalised}%`)))
      .orderBy(fileObjects.path);

    const entries = new Map<string, FileEntryDto>();
    for (const row of rows) {
      const rest = row.path.slice(normalised.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (rest === FOLDER_MARKER) {
          continue;
        }
        entries.set(row.path, {
          path: row.path,
          kind: "file",
          size: row.size,
          mime: row.mime,
          updatedAt: row.updatedAt.toISOString(),
        });
        continue;
      }
      const folder = `${normalised}${rest.slice(0, slash)}/`;
      if (!entries.has(folder)) {
        entries.set(folder, { path: folder, kind: "folder", size: 0, mime: "", updatedAt: null });
      }
    }
    return [...entries.values()];
  }

  async read(projectId: string, path: string): Promise<{ path: string; content: string; mime: string }> {
    const row = await this.requireRow(projectId, path);
    const content = await this.storage.get(row.bucketKey);
    if (content === null) {
      throw new NotFoundException(`${path} is indexed but missing from storage`);
    }
    return { path: row.path, content, mime: row.mime };
  }

  async write(
    projectId: string,
    path: string,
    content: string,
    mime = "text/plain",
  ): Promise<FileEntryDto> {
    const normalised = normalisePath(path);
    if (normalised === null || normalised.endsWith("/")) {
      throw new BadRequestException("invalid file path");
    }
    const bucketKey = `${projectId}${normalised}`;
    await this.storage.put(bucketKey, content, mime);

    const size = Buffer.byteLength(content);
    const [row] = await this.db
      .insert(fileObjects)
      .values({ projectId, path: normalised, bucketKey, mime, size })
      .onConflictDoUpdate({
        target: [fileObjects.projectId, fileObjects.path],
        set: { mime, size, bucketKey, updatedAt: new Date() },
      })
      .returning();

    return {
      path: row!.path,
      kind: "file",
      size: row!.size,
      mime: row!.mime,
      updatedAt: row!.updatedAt.toISOString(),
    };
  }

  async remove(projectId: string, path: string): Promise<void> {
    const row = await this.requireRow(projectId, path);
    await this.storage.remove(row.bucketKey);
    await this.db.delete(fileObjects).where(eq(fileObjects.id, row.id));
  }

  async mkdir(projectId: string, path: string): Promise<void> {
    const folder = normalisePath(path.endsWith("/") ? path : `${path}/`);
    if (folder === null) {
      throw new BadRequestException("invalid folder path");
    }
    await this.write(projectId, `${folder}${FOLDER_MARKER}`, "", "text/plain");
  }

  /* ── Agent surface (ACL enforced) ───────────────────────────────────── */

  /**
   * Runs one filesystem operation on an agent's behalf. Returns the refusal
   * text instead of throwing so the agent can adapt rather than crash.
   */
  async runAsAgent(
    projectId: string,
    caller: AgentFsCaller,
    operation: FsOperation,
    path: string,
    payload?: { content?: string; mime?: string },
  ): Promise<{ ok: boolean; text: string }> {
    const decision = authorizeFs({
      agentSlug: caller.agentSlug,
      grants: caller.grants,
      operation,
      path,
    });
    if (!decision.allowed) {
      return { ok: false, text: `refused: ${decision.reason}` };
    }

    switch (operation) {
      case "list": {
        const entries = await this.list(projectId, decision.path);
        return {
          ok: true,
          text:
            entries.length === 0
              ? "(empty)"
              : entries.map((entry) => `${entry.kind === "folder" ? "d" : "-"} ${entry.path}`).join("\n"),
        };
      }
      case "read": {
        const file = await this.read(projectId, decision.path);
        return { ok: true, text: file.content };
      }
      case "write": {
        const entry = await this.write(
          projectId,
          decision.path,
          payload?.content ?? "",
          payload?.mime ?? "text/plain",
        );
        return { ok: true, text: `wrote ${entry.path} (${entry.size} bytes)` };
      }
      case "mkdir": {
        await this.mkdir(projectId, decision.path);
        return { ok: true, text: `created ${decision.path}` };
      }
      case "delete": {
        await this.remove(projectId, decision.path);
        return { ok: true, text: `deleted ${decision.path}` };
      }
    }
  }

  private async requireRow(projectId: string, path: string) {
    const normalised = normalisePath(path);
    if (normalised === null) {
      throw new BadRequestException("invalid path");
    }
    const row = await this.db.query.fileObjects.findFirst({
      where: and(eq(fileObjects.projectId, projectId), eq(fileObjects.path, normalised)),
    });
    if (!row) {
      throw new NotFoundException(`${normalised} not found`);
    }
    return row;
  }
}
