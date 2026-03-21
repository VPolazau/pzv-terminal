import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WORKER_NAME: z.string().min(1).default('worker'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  RUNNER_MODE: z.enum(['single', 'subs']).default('single'),
  MOCK_TIME_SCALE: z.coerce.number().positive().default(1),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid env:\n${msg}`);
  }

  cached = parsed.data;
  return cached;
}
