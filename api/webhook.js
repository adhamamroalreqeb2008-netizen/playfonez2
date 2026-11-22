const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function setStatus(requestId, status) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    await fetch(`${REDIS_URL}/set/verify:${encodeURIComponent(requestId)}/${encodeURIComponent(status)}/ex/3600`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
  } catch (_) {}
}

async function getStatus(requestId) {
  if (!REDIS_URL || !REDIS_TOKEN) return "pending";
  try {
    const res = await fetch(`${REDIS_URL}/get/verify:${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      cache: "no-store"
    });
    const data = await res.json();
    return data.result || "pending";
  } catch (_) {
    return "pending";
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const requestId = String(req.query.requestId || "").trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: "Missing requestId" });
    }
    const status = await getStatus(requestId);
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
      const rawData = String(cq.data || "");
      const [action, requestId] = rawData.split(":");

      if (requestId && (action === "approve" || action === "reject")) {
        const nextStatus = action === "approve" ? "approved" : "rejected";
        await setStatus(requestId, nextStatus);

        if (botToken && cq.id) {
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

        if (botToken && cq.message) {
          const decisionLine =
            action === "approve"
              ? "✅ تمت الموافقة على الطلب"
              : "❌ تم رفض الطلب";

          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: `${cq.message.text || ""}\n\n${decisionLine}`
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
