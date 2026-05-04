export default async function handler(req, res) {
  try {
    // 1. Obtener datos del S&P 500 desde Yahoo Finance
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/^GSPC?interval=1h&range=5d';
    const response = await fetch(url);
    const data = await response.json();

    const closes = data.chart.result[0].indicators.quote[0].close;
    const validCloses = closes.filter(c => c !== null);

    // 2. Calcular EMA
    function calcEMA(prices, period) {
      const k = 2 / (period + 1);
      let ema = prices[0];
      for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
      }
      return ema;
    }

    // 3. Calcular RSI
    function calcRSI(prices, period = 14) {
      let gains = 0, losses = 0;
      for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
      }
      const rs = gains / losses;
      return 100 - 100 / (1 + rs);
    }

    const ema20 = calcEMA(validCloses, 20);
    const ema50 = calcEMA(validCloses, 50);
    const rsi = calcRSI(validCloses, 14);
    const close = validCloses[validCloses.length - 1];

    // 4. Detectar señal
    const prevEma20 = calcEMA(validCloses.slice(0, -1), 20);
    const prevEma50 = calcEMA(validCloses.slice(0, -1), 50);

    let signal = null;
    if (prevEma20 < prevEma50 && ema20 > ema50 && rsi > 50 && rsi < 70) {
      signal = 'COMPRA';
    } else if (prevEma20 > prevEma50 && ema20 < ema50 && rsi < 50) {
      signal = 'VENTA';
    }

    if (!signal) {
      return res.status(200).json({ ok: true, message: 'Sin señal', ema20, ema50, rsi });
    }

    // 5. Llamar a Claude
    const prompt = `
      Sos un asistente de trading para el S&P 500.
      Timeframe: 1 hora (H1)
      
      Señal detectada: ${signal}
      
      Datos del mercado:
      - Precio actual: $${close.toFixed(2)}
      - EMA 20: ${ema20.toFixed(2)}
      - EMA 50: ${ema50.toFixed(2)}
      - RSI (14): ${rsi.toFixed(2)}
      
      Analizá y respondé exactamente así:
      
      📊 SEÑAL: [COMPRA/VENTA/NEUTRAL]
      💰 Entrada: $[precio]
      🛡️ Stop Loss: $[precio] ([porcentaje]%)
      🎯 Take Profit: $[precio] ([porcentaje]%)
      📝 Análisis: [2 líneas máximo]
      ⚡ Confianza: [Alta/Media/Baja]
      ⚠️ Recordatorio: Esto no es asesoramiento financiero.
    `;

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

    // 6. Enviar a Telegram
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

    return res.status(200).json({ ok: true, signal, analysis });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
