const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Escape special characters for Telegram MarkdownV2 format.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Send a text message via Telegram Bot API.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  parseMode: string = "MarkdownV2"
): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`sendMessage error for chat ${chatId}:`, err);
  }
}

export async function sendQuizPoll(
  chatId: string,
  question: string,
  options: string[],
  correctOptionId: number,
  explanation?: string
): Promise<string | null> {
  // NOTE: ใช้ type "regular" แทน "quiz" เพื่อให้ Telegram ส่ง poll_answer webhook
  // กลับมาหาบอทเมื่อ user ตอบ — Telegram Quiz Poll จะไม่ส่ง poll_answer webhook
  // บอทเป็นคนตรวจคำตอบเองและแจ้งผลผ่าน sendMessage แทน
  const res = await fetch(`${TELEGRAM_API}/sendPoll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      question,
      options: options.map((o) => ({ text: o })),
      type: "regular",
      is_anonymous: false,
      allows_multiple_answers: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`sendPoll error for chat ${chatId}:`, err);
    return null;
  }

  const data = await res.json();
  return data.result?.poll?.id?.toString() || null;
}
