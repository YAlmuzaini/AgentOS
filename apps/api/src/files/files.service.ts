import { type Database, fileObjects } from "@agentos/db";
import {
  authorizeFs,
  type FileEntryDto,
  type FilesystemGrant,
  type FsOperation,
  isTextual,
  normalisePath,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray, like } from "drizzle-orm";
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
      const known = entries.get(folder);
      if (known) {
        // Counted while walking the rows we already fetched: a folder that
        // holds nothing looks the same as one holding forty otherwise.
        known.childCount = (known.childCount ?? 0) + 1;
        continue;
      }
      entries.set(folder, {
        path: folder,
        kind: "folder",
        size: 0,
        mime: "",
        updatedAt: null,
        childCount: 1,
      });
    }
    return [...entries.values()];
  }

  async read(projectId: string, path: string): Promise<{ path: string; content: string; mime: string }> {
    const row = await this.requireRow(projectId, path);
    // A binary file read as text is mojibake with a wrong length, and an editor
    // that saved it back would corrupt the object. Refusing sends the caller to
    // the download route, which is the one that can actually carry it.
    if (!isTextual(row.mime, row.path)) {
      throw new BadRequestException(
        `${row.path} is ${row.mime}, which is not text — download or preview it instead`,
      );
    }
    const content = await this.storage.get(row.bucketKey);
    if (content === null) {
      throw new NotFoundException(`${path} is indexed but missing from storage`);
    }
    return { path: row.path, content, mime: row.mime };
  }

  /** The bytes, whatever they are. Used by download and preview. */
  async readBytes(
    projectId: string,
    path: string,
  ): Promise<{ path: string; bytes: Buffer; mime: string }> {
    const row = await this.requireRow(projectId, path);
    const bytes = await this.storage.getBytes(row.bucketKey);
    if (bytes === null) {
      throw new NotFoundException(`${path} is indexed but missing from storage`);
    }
    return { path: row.path, bytes, mime: row.mime };
  }

  /**
   * Stores raw bytes — an upload from the operator's own machine (SPEC §7).
   *
   * The same index row and the same paths as a text write, so an uploaded
   * design mock and an agent-written spec sit side by side and both can be
   * attached to a task.
   */
  async writeBytes(
    projectId: string,
    path: string,
    bytes: Buffer,
    mime = "application/octet-stream",
  ): Promise<FileEntryDto> {
    const normalised = normalisePath(path);
    if (normalised === null || normalised.endsWith("/")) {
      throw new BadRequestException("invalid file path");
    }
    const bucketKey = `${projectId}${normalised}`;
    await this.storage.put(bucketKey, bytes, mime);

    const [row] = await this.db
      .insert(fileObjects)
      .values({ projectId, path: normalised, bucketKey, mime, size: bytes.byteLength })
      .onConflictDoUpdate({
        target: [fileObjects.projectId, fileObjects.path],
        set: { mime, size: bytes.byteLength, bucketKey, updatedAt: new Date() },
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

  /**
   * Paths for a set of file ids, in the order they were asked for.
   *
   * Task attachments are stored as ids and read as paths — the agent works in
   * paths, because that is what the filesystem tools take. Ids belonging to
   * another project resolve to nothing rather than to a path.
   */
  /**
   * Deletes every stored object this project owns, and says how many.
   *
   * The `file_objects` rows cascade when a project goes, but a cascade only
   * removes the index — the bytes in R2 stay, unreachable and still billed,
   * which is the opposite of what "delete this project" promises.
   *
   * Split in two on purpose. The keys are read *before* the rows are deleted
   * and the objects removed *after* the delete commits, because doing it in one
   * step meant a deletion that was later refused had already destroyed the
   * files. Failures are counted rather than thrown: a bucket that has already
   * lost an object must not block anything.
   */
  async bucketKeysForProject(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ bucketKey: fileObjects.bucketKey })
      .from(fileObjects)
      .where(eq(fileObjects.projectId, projectId));
    return rows.map((row) => row.bucketKey);
  }

  async removeAllForProject(bucketKeys: string[]): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;
    for (const key of bucketKeys) {
      try {
        await this.storage.remove(key);
        removed++;
      } catch {
        failed++;
      }
    }
    return { removed, failed };
  }

  async pathsByIds(projectId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select({ id: fileObjects.id, path: fileObjects.path })
      .from(fileObjects)
      .where(and(eq(fileObjects.projectId, projectId), inArray(fileObjects.id, ids)));
    const byId = new Map(rows.map((row) => [row.id, row.path]));
    return ids.map((id) => byId.get(id)).filter((path): path is string => Boolean(path));
  }

  /** Directory entries for a set of ids — what a task's attachments render as. */
  async entriesByIds(projectId: string, ids: string[]): Promise<FileEntryDto[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(fileObjects)
      .where(and(eq(fileObjects.projectId, projectId), inArray(fileObjects.id, ids)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row
        ? [
            {
              path: row.path,
              kind: "file" as const,
              size: row.size,
              mime: row.mime,
              updatedAt: row.updatedAt.toISOString(),
            },
          ]
        : [];
    });
  }

  /** The file row at a path, when the operator or an agent needs its id. */
  async idForPath(projectId: string, path: string): Promise<{ id: string; path: string }> {
    const row = await this.requireRow(projectId, path);
    return { id: row.id, path: row.path };
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
        try {
          const file = await this.read(projectId, decision.path);
          return { ok: true, text: file.content };
        } catch (error) {
          // A binary file is a legitimate thing to find and not a crash: the
          // agent is told what it is so it can move on rather than retry.
          if (error instanceof BadRequestException) {
            return { ok: false, text: `refused: ${error.message}` };
          }
          throw error;
        }
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
