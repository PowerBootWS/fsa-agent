// Messages to Russ on the dedicated coach Telegram bot (@fsa_coaching_bot,
// backlog #139). Student follow-ups go here, never to Olivia's chat, so they
// don't get buried among Reddit drafts and enrollment pings.
//
// Send-only. Nothing reads messages sent TO this bot yet; when something does,
// it must accept only COACH_TELEGRAM_CHAT_ID and fail closed.

async function notify(text, { fetchFn = fetch } = {}) {
  const token = process.env.COACH_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.COACH_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[coachBot] COACH_TELEGRAM_BOT_TOKEN / COACH_TELEGRAM_CHAT_ID not set; not sent:', text.slice(0, 80));
    return false;
  }
  const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
  return true;
}

module.exports = { notify };
