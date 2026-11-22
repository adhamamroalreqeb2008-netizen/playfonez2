const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function setStatus(requestId, status) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Missing Redis URL or Token");
  }
  const key = encodeURIComponent(`verify:${requestId}`);
  const val = encodeURIComponent(status);
  const res = await fetch(`${REDIS_URL}/set/${key}/${val}/ex/3600`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const data = await res.json();
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

  const botToken = process.env.BOT_TOKEN;
  const rawBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

  console.log("WEBHOOK HIT:", {
    hasCallback: Boolean(rawBody?.callback_query),
    data: rawBody?.callback_query?.data || null,
    hasBotToken: Boolean(botToken),
    hasRedisUrl: Boolean(REDIS_URL),
    hasRedisToken: Boolean(REDIS_TOKEN)
  });

  try {
    const update = rawBody;

    if (update && update.callback_query) {
      const cq = update.callback_query;
      const rawData = String(cq.data || "");
      const [action, requestId] = rawData.split(":");

      if (requestId && (action === "approve" || action === "reject")) {
        const nextStatus = action === "approve" ? "approved" : "rejected";
        await setStatus(requestId, nextStatus);
        console.log("REDIS UPDATED:", { requestId, nextStatus });

        if (botToken && cq.id) {
          const ansRes = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: cq.id,
              text: action === "approve" ? "تمت الموافقة" : "تم الرفض",
              show_alert: false
            })
          });
          const ansJson = await ansRes.json().catch(() => ({}));
          console.log("ANSWER CALLBACK:", ansJson.ok, ansJson.description || "");
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

          const editPayload = {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            [field]: `${baseText}\n\n${decisionLine}`,
            reply_markup: { inline_keyboard: [] }
          };

          if (!isCaption && cq.message.entities) {
            editPayload.entities = cq.message.entities;
          }
          if (isCaption && cq.message.caption_entities) {
            editPayload.caption_entities = cq.message.caption_entities;
          }

          const editRes = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editPayload)
          });
          const editJson = await editRes.json().catch(() => ({}));
          console.log("EDIT MESSAGE:", editJson.ok, editJson.description || "");
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
