import { sendTelegramMessage, TelegramDeliveryError } from './send-telegram';
const params = { token: 'test-only', chatId: 'test-chat', text: 'SMA LIVE' };
describe('Telegram HTTP acknowledgement', () => {
  afterEach(() => jest.restoreAllMocks());
  it('accepts a positive API acknowledgement', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })),
      );
    await expect(sendTelegramMessage(params)).resolves.toBeUndefined();
  });
  it('rejects an API-level error even with HTTP 200', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: false })));
    await expect(sendTelegramMessage(params)).rejects.toBeInstanceOf(
      TelegramDeliveryError,
    );
  });
  it('retains Telegram retry_after', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, parameters: { retry_after: 3 } }),
          { status: 429 },
        ),
      );
    await expect(sendTelegramMessage(params)).rejects.toMatchObject({
      retryAfterSeconds: 3,
    });
  });
  it('does not expose the token if transport throws an error containing the URL', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(
        new Error('failed https://api.telegram.org/bottest-only/sendMessage'),
      );
    await expect(sendTelegramMessage(params)).rejects.toThrow(
      'Telegram request failed or timed out',
    );
  });
});
