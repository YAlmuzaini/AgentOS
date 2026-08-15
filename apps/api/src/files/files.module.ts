import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { ObjectStorage } from "./storage";

@Module({
  controllers: [FilesController],
  providers: [ObjectStorage, FilesService],
  exports: [FilesService],
})
export class FilesModule {}
