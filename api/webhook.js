const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim();
const REDIS_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();

async function setStatus(requestId, status) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Missing REDIS_URL or REDIS_TOKEN in Vercel");
  }
  const key = encodeURIComponent(`verify:${requestId}`);
  const val = encodeURIComponent(status);
  const res = await fetch(`${REDIS_URL}/set/${key}/${val}/ex/3600`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `Redis HTTP ${res.status}`);
  }
  return data;
}

async function getStatus(requestId) {
  if (!REDIS_URL || !REDIS_TOKEN) return "pending";
  try {
    const key = encodeURIComponent(`verify:${requestId}`);
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
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
  res.setHeader("Cache-Control", "no-store");

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

  const botToken = (process.env.BOT_TOKEN || "").trim();
  const update = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

  if (update && update.callback_query) {
    const cq = update.callback_query;
    const rawData = String(cq.data || "").trim();
    const colonIdx = rawData.indexOf(":");
    const action = colonIdx !== -1 ? rawData.slice(0, colonIdx).trim() : "";
    const requestId = colonIdx !== -1 ? rawData.slice(colonIdx + 1).trim() : "";

    if (requestId && (action === "approve" || action === "reject")) {
      const nextStatus = action === "approve" ? "approved" : "rejected";

      try {
        await setStatus(requestId, nextStatus);
      } catch (redisErr) {
        console.error("REDIS WRITE ERROR:", redisErr.message);
        if (botToken && cq.id) {
          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: cq.id,
              text: `خطأ قاعدة البيانات: ${redisErr.message}`.slice(0, 190),
              show_alert: true
            })
          });
        }
        return res.status(200).json({ ok: false, error: redisErr.message });
      }

      if (botToken && cq.id) {
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: cq.id,
            text: action === "approve" ? "تمت الموافقة بنجاح" : "تم الرفض",
            show_alert: false
          })
        });
      }

      if (botToken && cq.message) {
        const decisionLine =
          action === "approve"
            ? "✅ تمت الموافقة على الطلب"
            : "❌ تم رفض الطلب";
        const baseText = cq.message.text ?? cq.message.caption ?? "";
        const isCaption = cq.message.text === undefined && cq.message.caption !== undefined;
        const endpoint = isCaption ? "editMessageCaption" : "editMessageText";
        const field = isCaption ? "caption" : "text";

        await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            [field]: `${baseText}\n\n${decisionLine}`,
            reply_markup: { inline_keyboard: [] }
          })
        });
      }
    }
  }

  return res.status(200).json({ ok: true });
}
