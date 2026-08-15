import { timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { APP_CONFIG, type AppConfig } from "../config/config";

/**
 * Single-operator auth (SPEC §20). One human, one bearer token, used by the web
 * UI and the CLI alike. There is no agent-facing HTTP surface in Phase 1 —
 * agent tool calls are executed inside the control plane by the session
 * orchestrator, so no token is ever handed to a container.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing bearer token");
    }

    if (!constantTimeEquals(header.slice("Bearer ".length), this.config.AGENTOS_OPERATOR_TOKEN)) {
      throw new UnauthorizedException("invalid operator token");
    }

    return true;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
