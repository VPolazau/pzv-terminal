export async function sendTelegramMessage(params: {
  token: string;
  chatId: string;
  text: string;
}): Promise<void> {
  const { token, chatId, text } = params;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Telegram sendMessage failed: ${res.status} ${res.statusText} ${body}`,
    );
  }
}
