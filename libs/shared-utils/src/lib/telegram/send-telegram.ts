export class TelegramDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export async function sendTelegramMessage(params: {
  token: string;
  chatId: string;
  text: string;
}): Promise<void> {
  const { token, chatId, text } = params;
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // Do not include a request URL (it contains the token) in logs.
    throw new TelegramDeliveryError('Telegram request failed or timed out');
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    parameters?: { retry_after?: number };
  } | null;
  if (!res.ok || body?.ok !== true) {
    throw new TelegramDeliveryError(
      `Telegram sendMessage failed: ${res.status}`,
      body?.parameters?.retry_after,
    );
  }
}
