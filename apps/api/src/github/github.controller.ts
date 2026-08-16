import type { GithubInstallationDto, GithubStatusDto, RemoteRepoDto } from "@agentos/shared";
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Redirect,
  UseGuards,
} from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { GithubService } from "./github.service";

/**
 * Connecting GitHub, the operator half. Guarded like every other project route.
 */
@Controller("projects/:projectId/github")
@UseGuards(OperatorGuard)
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get("status")
  status(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<GithubStatusDto> {
    return this.github.status(projectId);
  }

  /** The URL to send the browser to. Not a redirect: the UI opens it itself. */
  @Get("install-url")
  installUrl(@Param("projectId", ParseUUIDPipe) projectId: string): Promise<{ url: string }> {
    return this.github.installUrl(projectId);
  }

  @Get("installations/:id/repositories")
  repositories(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<RemoteRepoDto[]> {
    return this.github.listRepositories(projectId, id);
  }

  @Delete("installations/:id")
  async remove(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.github.remove(projectId, id);
  }
}

/**
 * Where GitHub sends the operator's browser after they approve the App.
 *
 * Deliberately **not** behind `OperatorGuard`: this is a top-level redirect
 * from github.com, so it carries no bearer token and cannot be made to. Its
 * authentication is the single-use `state` issued when Connect was pressed,
 * and the `installation_id` it carries is treated as a claim until GitHub
 * confirms the installation belongs to this App.
 *
 * Nothing here reads a session or a cookie, so there is no CSRF surface: the
 * worst a forged call achieves is a 400.
 */
@Controller("github")
export class GithubCallbackController {
  constructor(private readonly github: GithubService) {}

  @Get("setup")
  @Redirect()
  async setup(
    @Query("installation_id") installationId?: string,
    @Query("state") state?: string,
    @Query("setup_action") setupAction?: string,
  ): Promise<{ url: string }> {
    const result = await this.github.completeInstall({
      installationId: installationId ?? "",
      state,
      setupAction,
    });
    return { url: result.redirectTo };
  }
}
