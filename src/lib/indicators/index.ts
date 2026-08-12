/**
 * Indicator engine — deterministic, in-house, computed from OANDA candles.
 *
 * Not sourced from TradingView: there is no public TradingView API for reading
 * chart or indicator values. Computing them here gives the AI precise numbers
 * rather than pixels, and makes every result reproducible and testable.
 *
 * Conventions, applied consistently:
 *   • every function returns an array the SAME LENGTH as its input
 *   • positions with insufficient history are NaN, never 0 and never truncated
 *   • Wilder smoothing is used for RSI, ATR and ADX, as in the original
 *     definitions — EMA-based variants give different numbers, and mixing the
 *     two is a common source of "why doesn't this match my platform?"
 */

export type Bar = {
  /** Epoch milliseconds, UTC. */
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** ⚠️ Tick count on FX/CFDs, NOT traded volume. */
  v: number;
};

const nan = (n: number) => new Array<number>(n).fill(NaN);

/* ==========================================================================
   MOVING AVERAGES
   ========================================================================== */

export function sma(values: number[], period: number): number[] {
  const out = nan(values.length);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = nan(values.length);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values, the standard convention.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (RMA) — used by RSI, ATR and ADX. */
function wilder(values: number[], period: number, startIndex: number): number[] {
  const out = nan(values.length);
  if (values.length < startIndex + period) return out;
  let sum = 0;
  for (let i = startIndex; i < startIndex + period; i++) sum += values[i];
  let prev = sum / period;
  out[startIndex + period - 1] = prev;
  for (let i = startIndex + period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/* ==========================================================================
   VOLATILITY
   ========================================================================== */

export function trueRange(bars: Bar[]): number[] {
  const out = nan(bars.length);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      out[i] = bars[i].h - bars[i].l;
      continue;
    }
    const pc = bars[i - 1].c;
    out[i] = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - pc),
      Math.abs(bars[i].l - pc),
    );
  }
  return out;
}

/**
 * Average True Range (Wilder).
 *
 * Does double duty in this app: volatility-regime classification, and
 * normalising stop distances so a setup on EUR_USD and one on XAU_USD are
 * measured on the same scale.
 */
export function atr(bars: Bar[], period = 14): number[] {
  return wilder(trueRange(bars), period, 1);
}

export function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): { upper: number[]; mid: number[]; lower: number[] } {
  const mid = sma(closes, period);
  const upper = nan(closes.length);
  const lower = nan(closes.length);
  for (let i = period - 1; i < closes.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, mid, lower };
}

export function keltner(
  bars: Bar[],
  period = 20,
  mult = 2,
): { upper: number[]; mid: number[]; lower: number[] } {
  const mid = ema(bars.map((b) => b.c), period);
  const a = atr(bars, period);
  const upper = nan(bars.length);
  const lower = nan(bars.length);
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isNaN(mid[i]) && !Number.isNaN(a[i])) {
      upper[i] = mid[i] + mult * a[i];
      lower[i] = mid[i] - mult * a[i];
    }
  }
  return { upper, mid, lower };
}

/* ==========================================================================
   MOMENTUM
   ========================================================================== */

export function rsi(closes: number[], period = 14): number[] {
  const out = nan(closes.length);
  if (closes.length <= period) return out;

  const gains = nan(closes.length);
  const losses = nan(closes.length);
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }

  const avgGain = wilder(gains, period, 1);
  const avgLoss = wilder(losses, period, 1);

  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(avgGain[i]) || Number.isNaN(avgLoss[i])) continue;
    // All-gain windows are RSI 100 by definition; guard the divide.
    out[i] = avgLoss[i] === 0 ? 100 : 100 - 100 / (1 + avgGain[i] / avgLoss[i]);
  }
  return out;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { line: number[]; signal: number[]; hist: number[] } {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const line = nan(closes.length);
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isNaN(fastE[i]) && !Number.isNaN(slowE[i])) line[i] = fastE[i] - slowE[i];
  }

  // The signal EMA must start where the MACD line starts, not at index 0.
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const signal = nan(closes.length);
  if (firstValid >= 0) {
    const sig = ema(line.slice(firstValid), signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i];
  }

  const hist = nan(closes.length);
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isNaN(line[i]) && !Number.isNaN(signal[i])) hist[i] = line[i] - signal[i];
  }
  return { line, signal, hist };
}

export function stochastic(
  bars: Bar[],
  kPeriod = 14,
  dPeriod = 3,
  smooth = 3,
): { k: number[]; d: number[] } {
  const raw = nan(bars.length);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].h > hh) hh = bars[j].h;
      if (bars[j].l < ll) ll = bars[j].l;
    }
    raw[i] = hh === ll ? 50 : ((bars[i].c - ll) / (hh - ll)) * 100;
  }
  const k = smoothSeries(raw, smooth);
  const d = smoothSeries(k, dPeriod);
  return { k, d };
}

/** SMA that tolerates leading NaNs, for chaining derived series. */
function smoothSeries(values: number[], period: number): number[] {
  const out = nan(values.length);
  if (period <= 1) return values.slice();
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) {
        ok = false;
        break;
      }
      sum += values[j];
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}

export function cci(bars: Bar[], period = 20): number[] {
  const out = nan(bars.length);
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
  const tpSma = sma(tp, period);
  for (let i = period - 1; i < bars.length; i++) {
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - tpSma[i]);
    const meanDev = dev / period;
    out[i] = meanDev === 0 ? 0 : (tp[i] - tpSma[i]) / (0.015 * meanDev);
  }
  return out;
}

/* ==========================================================================
   TREND STRENGTH
   ========================================================================== */

export function adx(
  bars: Bar[],
  period = 14,
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = bars.length;
  const plusDM = nan(n);
  const minusDM = nan(n);

  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const down = bars[i - 1].l - bars[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  const trS = wilder(trueRange(bars), period, 1);
  const plusS = wilder(plusDM, period, 1);
  const minusS = wilder(minusDM, period, 1);

  const plusDI = nan(n);
  const minusDI = nan(n);
  const dx = nan(n);

  for (let i = 0; i < n; i++) {
    if (Number.isNaN(trS[i]) || trS[i] === 0) continue;
    plusDI[i] = (plusS[i] / trS[i]) * 100;
    minusDI[i] = (minusS[i] / trS[i]) * 100;
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100;
  }

  // ADX is Wilder-smoothed DX, starting where DX first becomes valid.
  const firstDx = dx.findIndex((v) => !Number.isNaN(v));
  const adxOut = nan(n);
  if (firstDx >= 0) {
    const smoothed = wilder(dx.slice(firstDx), period, 0);
    for (let i = 0; i < smoothed.length; i++) adxOut[firstDx + i] = smoothed[i];
  }

  return { adx: adxOut, plusDI, minusDI };
}

/* ==========================================================================
   STRUCTURE
   ========================================================================== */

/**
 * Fractal swing points: a bar whose high exceeds `lookback` bars either side.
 *
 * Note the inherent lag — a swing is only confirmed `lookback` bars after it
 * forms. Backtests that treat swings as known at the time they printed are
 * looking into the future; the evaluator accounts for this.
 */
export function swingHighs(bars: Bar[], lookback = 2): boolean[] {
  const out = new Array<boolean>(bars.length).fill(false);
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && bars[j].h >= bars[i].h) {
        isSwing = false;
        break;
      }
    }
    out[i] = isSwing;
  }
  return out;
}

export function swingLows(bars: Bar[], lookback = 2): boolean[] {
  const out = new Array<boolean>(bars.length).fill(false);
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && bars[j].l <= bars[i].l) {
        isSwing = false;
        break;
      }
    }
    out[i] = isSwing;
  }
  return out;
}

/**
 * Most recent CONFIRMED swing high at each bar.
 *
 * "Confirmed" is doing real work here: a swing at index k is only knowable at
 * k + lookback, so that is when it becomes available. Without this offset a
 * backtest silently uses future information and every result is inflated.
 */
export function lastSwingHigh(bars: Bar[], lookback = 2): number[] {
  const swings = swingHighs(bars, lookback);
  const out = nan(bars.length);
  let current = NaN;
  for (let i = 0; i < bars.length; i++) {
    const confirmedIdx = i - lookback;
    if (confirmedIdx >= 0 && swings[confirmedIdx]) current = bars[confirmedIdx].h;
    out[i] = current;
  }
  return out;
}

export function lastSwingLow(bars: Bar[], lookback = 2): number[] {
  const swings = swingLows(bars, lookback);
  const out = nan(bars.length);
  let current = NaN;
  for (let i = 0; i < bars.length; i++) {
    const confirmedIdx = i - lookback;
    if (confirmedIdx >= 0 && swings[confirmedIdx]) current = bars[confirmedIdx].l;
    out[i] = current;
  }
  return out;
}

/**
 * Session-anchored VWAP.
 *
 * ⚠️ On FX and CFDs this is TICK-derived, because there is no centralised
 * volume. It is a real signal that many traders watch, but it is not the
 * volume-weighted price an equities trader means by VWAP. Label it as such
 * wherever it surfaces in the UI.
 */
export function vwapAnchored(bars: Bar[], isAnchor: (bar: Bar, i: number) => boolean): number[] {
  const out = nan(bars.length);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    if (isAnchor(bars[i], i)) {
      cumPV = 0;
      cumV = 0;
    }
    const tp = (bars[i].h + bars[i].l + bars[i].c) / 3;
    const v = bars[i].v || 1; // guard against zero-tick bars
    cumPV += tp * v;
    cumV += v;
    out[i] = cumV > 0 ? cumPV / cumV : NaN;
  }
  return out;
}

/** Rolling highest high / lowest low over `period` bars, excluding the current bar. */
export function priorHigh(bars: Bar[], period: number): number[] {
  const out = nan(bars.length);
  for (let i = period; i < bars.length; i++) {
    let hh = -Infinity;
    for (let j = i - period; j < i; j++) if (bars[j].h > hh) hh = bars[j].h;
    out[i] = hh;
  }
  return out;
}

export function priorLow(bars: Bar[], period: number): number[] {
  const out = nan(bars.length);
  for (let i = period; i < bars.length; i++) {
    let ll = Infinity;
    for (let j = i - period; j < i; j++) if (bars[j].l < ll) ll = bars[j].l;
    out[i] = ll;
  }
  return out;
}
