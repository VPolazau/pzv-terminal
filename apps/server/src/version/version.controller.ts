import { Controller, Get } from "@nestjs/common";

@Controller("version")
export class VersionController {
  @Get()
  version() {
    return {
      name: "@pzv-terminal/source",
      node: process.version,
      env: process.env.NODE_ENV ?? "unknown",
    };
  }
}
