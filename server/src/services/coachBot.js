// Messages to Russ on the dedicated coach Telegram bot (@fsa_coaching_bot,
// backlog #139). Student follow-ups and text drafts go here, never to Olivia's
// chat, so they don't get buried among Reddit drafts and enrollment pings.
//
// Inbound (Russ's messages and button taps) goes to fsa-webhook-listener's
// /webhook/coach-telegram, which accepts only COACH_TELEGRAM_CHAT_ID.

function cfg() {
  const token = process.env.COACH_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.COACH_TELEGRAM_CHAT_ID;
  return token && chatId ? { token, chatId } : null;
}

function keyboard(buttons) {
  return buttons ? { reply_markup: { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.text, callback_data: b.data }))) } } : {};
}

async function api(method, body, fetchFn) {
  const c = cfg();
  const res = await fetchFn(`https://api.telegram.org/bot${c.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Telegram ${method} ${res.status}`);
  return res.json().catch(() => ({}));
}

// `buttons`: rows of { text, data } shown under the message. A tap comes back
// as a callback_query. Returns the Telegram message id (truthy) once sent.
async function notify(text, { fetchFn = fetch, buttons } = {}) {
  const c = cfg();
  if (!c) {
    console.warn('[coachBot] COACH_TELEGRAM_BOT_TOKEN / COACH_TELEGRAM_CHAT_ID not set; not sent:', text.slice(0, 80));
    return false;
  }
  const d = await api('sendMessage', { chat_id: c.chatId, text, disable_web_page_preview: true, ...keyboard(buttons) }, fetchFn);
  return d?.result?.message_id || true;
}

/** Replace a message's text and drop (or replace) its buttons. */
async function edit(messageId, text, { fetchFn = fetch, buttons } = {}) {
  const c = cfg();
  if (!c || !messageId) return false;
  await api('editMessageText', {
    chat_id: c.chatId, message_id: messageId, text, disable_web_page_preview: true, ...keyboard(buttons),
  }, fetchFn);
  return true;
}

module.exports = { notify, edit };
