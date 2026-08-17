import { Global, Module } from "@nestjs/common";
import { RunnerModule } from "../runner/runner.module";
import { CapabilitiesController } from "./capabilities.controller";
import { CapabilityService } from "./capability.service";
import { PreflightService } from "./preflight.service";

@Global()
@Module({
  imports: [RunnerModule],
  controllers: [CapabilitiesController],
  providers: [CapabilityService, PreflightService],
  exports: [CapabilityService, PreflightService],
})
export class CapabilitiesModule {}
