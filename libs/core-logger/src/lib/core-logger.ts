import pino, { Logger, LoggerOptions } from "pino";

export type CreateLoggerOptions = {
  name?: string;
  level?: string;
  pretty?: boolean;
};

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const level = opts.level ?? process.env['LOG_LEVEL'] ?? "info";
  const pretty =
    typeof opts.pretty === "boolean"
      ? opts.pretty
      : process.env['NODE_ENV'] !== "production";

  const options: LoggerOptions = {
    name: opts.name,
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    return pino(
      options,
      pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      })
    );
  }

  return pino(options);
}
