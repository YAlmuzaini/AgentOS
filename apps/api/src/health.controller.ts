import { Controller, Get } from "@nestjs/common";

/** Unauthenticated liveness probe. Reveals nothing about project state. */
@Controller("health")
export class HealthController {
  @Get()
  health(): { ok: true } {
    return { ok: true };
  }
}
