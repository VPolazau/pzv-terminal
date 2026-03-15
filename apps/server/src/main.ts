import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app/app.module";
import { getConfig } from "@pzv-terminal/core-config";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const globalPrefix = "api";
  app.setGlobalPrefix(globalPrefix);

  const config = getConfig();
  const port = config.SERVER_PORT;

  await app.listen(port);

  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
