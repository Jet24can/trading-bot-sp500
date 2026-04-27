export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { symbol, close, ema20, ema50, rsi, signal } = req.body;

  // 1. Prompt para Claude
  const prompt = `
    Sos un asistente de trading para el S&P 500.
    Timeframe: 1 hora (H1)
    
    Señal detectada: ${signal}
    
    Datos del mercado:
    - Precio actual: $${close}
    - EMA 20: ${ema20}
    - EMA 50: ${ema50}
    - RSI (14): ${rsi}
    
    Analizá y respondé exactamente así:
    
    📊 SEÑAL: [COMPRA/VENTA/NEUTRAL]
    💰 Entrada: $[precio]
    🛡️ Stop Loss: $[precio] ([porcentaje]%)
    🎯 Take Profit: $[precio] ([porcentaje]%)
    📝 Análisis: [2 líneas máximo]
    ⚡ Confianza: [Alta/Media/Baja]
    ⚠️ Recordatorio: Esto no es asesoramiento financiero.
  `;

  // 2. Llamar a Claude
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = await claudeRes.json();
  const analysis = claudeData.content[0].text;

  // 3. Enviar a Telegram
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🤖 *Alerta S&P 500 — H1*\n\n${analysis}`,
        parse_mode: 'Markdown'
      })
    }
  );

  return res.status(200).json({ ok: true });
}
