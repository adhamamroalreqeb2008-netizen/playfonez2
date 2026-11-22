const store = globalThis.__verifyStore || (globalThis.__verifyStore = new Map());

export default async function handler(req, res) {
  if (req.method === "GET") {
    const requestId = String(req.query.requestId || "").trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: "Missing requestId" });
    }
    const status = store.get(requestId) || "pending";
    return res.status(200).json({ ok: true, requestId, status });
  }

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const botToken = process.env.BOT_TOKEN;

  try {
    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (update && update.callback_query) {
      const cq = update.callback_query;
      const [action, requestId] = String(cq.data || "").split(":");

      if (requestId && (action === "approve" || action === "reject")) {
        const nextStatus = action === "approve" ? "approved" : "rejected";
        store.set(requestId, nextStatus);

        const label =
          action === "approve"
            ? "✅ *تمت الموافقة على الطلب*"
            : "❌ *تم رفض الطلب*";

        if (botToken && cq.message) {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: `${cq.message.text}\n\n${label}`,
              parse_mode: "Markdown"
            })
          });

          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: cq.id,
              text: action === "approve" ? "تمت الموافقة" : "تم الرفض",
              show_alert: false
            })
          });
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
