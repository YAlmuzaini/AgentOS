import type { RunnerStatusDto } from "@agentos/shared";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { RunnerRouter } from "./runner-router";

/**
 * Which backends can actually take a session right now.
 *
 * Not project-scoped, because availability is not a project fact: where the
 * local worker lives is `LOCAL_RUNNER_URL`, one value for the whole process.
 *
 * This exists so the settings screen can tell the truth. The default-runner
 * setting is a preference, not a promise — choosing `local` while no worker is
 * reachable routes every run to the cloud and bills for it, and an operator who
 * switched precisely to stop paying per token deserves to see that immediately
 * rather than on their next invoice.
 */
@Controller("runners")
@UseGuards(OperatorGuard)
export class RunnersController {
  constructor(private readonly router: RunnerRouter) {}

  @Get()
  status(): Promise<RunnerStatusDto> {
    return this.router.status();
  }
}
