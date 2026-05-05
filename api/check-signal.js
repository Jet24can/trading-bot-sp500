// v2.0 - MACD + Bollinger
export default async function handler(req, res) {
  try {
    // 1. Obtener datos del S&P 500
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/^GSPC?interval=1h&range=10d';
    const response = await fetch(url);
    const data = await response.json();

    const closes = data.chart.result[0].indicators.quote[0].close;
    const highs  = data.chart.result[0].indicators.quote[0].high;
    const lows   = data.chart.result[0].indicators.quote[0].low;
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
      const rs = gains / (losses || 1);
      return 100 - 100 / (1 + rs);
    }

    // 4. Calcular MACD
    function calcMACD(prices) {
      const ema12 = calcEMA(prices, 12);
      const ema26 = calcEMA(prices, 26);
      const macdLine = ema12 - ema26;

      // Signal line = EMA 9 del MACD (aproximación)
      const prevEma12 = calcEMA(prices.slice(0, -1), 12);
      const prevEma26 = calcEMA(prices.slice(0, -1), 26);
      const prevMacd  = prevEma12 - prevEma26;
      const signalLine = calcEMA([prevMacd, macdLine], 9);

      return { macdLine, signalLine, histogram: macdLine - signalLine };
    }

    // 5. Calcular Bollinger Bands
    function calcBollinger(prices, period = 20, mult = 2) {
      const slice = prices.slice(-period);
      const mean  = slice.reduce((a, b) => a + b, 0) / period;
      const std   = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
      return {
        upper: mean + mult * std,
        middle: mean,
        lower: mean - mult * std
      };
    }

    // 6. Calcular todos los indicadores
    const close   = validCloses[validCloses.length - 1];
    const ema20   = calcEMA(validCloses, 20);
    const ema50   = calcEMA(validCloses, 50);
    const rsi     = calcRSI(validCloses, 14);
    const macd    = calcMACD(validCloses);
    const bb      = calcBollinger(validCloses, 20);

    // Valores anteriores para detectar cruces
    const prev        = validCloses.slice(0, -1);
    const prevEma20   = calcEMA(prev, 20);
    const prevEma50   = calcEMA(prev, 50);
    const prevMacd    = calcMACD(prev);

    // 7. Detectar señales
    const emaCrossUp   = prevEma20 < prevEma50 && ema20 > ema50;
    const emaCrossDown = prevEma20 > prevEma50 && ema20 < ema50;
    const macdCrossUp  = prevMacd.macdLine < prevMacd.signalLine && macd.macdLine > macd.signalLine;
    const macdCrossDown= prevMacd.macdLine > prevMacd.signalLine && macd.macdLine < macd.signalLine;

    let signal = null;
    let strength = 0;

    // Señal de COMPRA
    if (emaCrossUp && rsi > 40 && rsi < 70) {
      signal = 'COMPRA';
      strength++;
      if (macdCrossUp) strength++;
      if (close <= bb.middle) strength++;
    }

    // Señal de VENTA
    if (emaCrossDown && rsi < 50) {
      signal = 'VENTA';
      strength++;
      if (macdCrossDown) strength++;
      if (close >= bb.upper) strength++;
    }

    const confidence = strength >= 3 ? 'Alta' : strength === 2 ? 'Media' : 'Baja';

    if (!signal) {
      return res.status(200).json({
        ok: true,
        message: 'Sin señal',
        indicators: {
          close: close.toFixed(2),
          ema20: ema20.toFixed(2),
          ema50: ema50.toFixed(2),
          rsi: rsi.toFixed(2),
          macd: macd.macdLine.toFixed(2),
          macdSignal: macd.signalLine.toFixed(2),
          bbUpper: bb.upper.toFixed(2),
          bbMiddle: bb.middle.toFixed(2),
          bbLower: bb.lower.toFixed(2)
        }
      });
    }

    // 8. Llamar a Claude con más contexto
    const prompt = `
      Sos un asistente de trading profesional para el S&P 500.
      Timeframe: 1 hora (H1)
      
      Señal detectada: ${signal}
      Confianza calculada: ${confidence} (${strength}/3 indicadores confirman)
      
      Indicadores actuales:
      - Precio: $${close.toFixed(2)}
      - EMA 20: ${ema20.toFixed(2)}
      - EMA 50: ${ema50.toFixed(2)}
      - RSI (14): ${rsi.toFixed(2)}
      - MACD Line: ${macd.macdLine.toFixed(2)}
      - MACD Signal: ${macd.signalLine.toFixed(2)}
      - Bollinger Superior: ${bb.upper.toFixed(2)}
      - Bollinger Medio: ${bb.middle.toFixed(2)}
      - Bollinger Inferior: ${bb.lower.toFixed(2)}
      
      Respondé exactamente así:
      
      📊 SEÑAL: ${signal}
      💰 Entrada: $[precio]
      🛡️ Stop Loss: $[precio] ([%])
      🎯 Take Profit: $[precio] ([%])
      📉 MACD: [interpretación breve]
      📈 Bollinger: [interpretación breve]
      ⚡ Confianza: ${confidence}
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
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const analysis = claudeData.content[0].text;

    // 9. Enviar a Telegram
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

    return res.status(200).json({ ok: true, signal, confidence, analysis });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
