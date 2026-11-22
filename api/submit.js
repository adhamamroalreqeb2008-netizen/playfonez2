export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const botToken = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ ok: false, error: "Missing BOT_TOKEN or CHAT_ID" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { requestId, name, eid, exp, fileName } = body || {};

    if (!requestId || !name || !eid || !exp) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const text =
      `🛡️ *طلب تحقق جديد*\n\n` +
      `• *رقم الطلب:* \`${requestId}\`\n` +
      `• *الاسم الكامل:* ${name}\n` +
      `• *رقم الهوية:* \`${eid}\`\n` +
      `• *تاريخ الانتهاء:* ${exp}\n` +
      `• *الملف:* ${fileName || "غير مرفق"}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ موافقة", callback_data: `approve:${requestId}` },
              { text: "❌ رفض", callback_data: `reject:${requestId}` }
            ]
          ]
        }
      })
    });

    const tgData = await tgRes.json();
    if (!tgData.ok) {
      return res.status(502).json({ ok: false, error: tgData.description || "Telegram error" });
    }

    return res.status(200).json({ ok: true, requestId });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
