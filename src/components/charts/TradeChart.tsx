"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

export type ChartBar = { time: number; o: number; h: number; l: number; c: number };

export type TradeChartProps = {
  bars: ChartBar[];
  direction: "long" | "short";
  entryTime: number;
  entryPrice: number;
  exitTime: number | null;
  exitPrice: number | null;
  stop: number | null;
  target: number | null;
  precision: number;
  height?: number;
};

/**
 * Auto-rendered trade chart.
 *
 * Every trade gets one automatically from cached candles — no screenshots to
 * remember, nothing forgotten, and identical rendering years later.
 *
 * Colour rule holds here too: entry and exit markers use the orange interface
 * accent, NOT green/red. Green and red on this chart mean only the candles
 * themselves, so a red marker can never be misread as a losing trade.
 */
export function TradeChart({
  bars,
  direction,
  entryTime,
  entryPrice,
  exitTime,
  exitPrice,
  stop,
  target,
  precision,
  height = 380,
}: TradeChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!container.current || bars.length === 0) return;

    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;

    const ink = v("--color-ink-dim", "#9b9ba5");
    const line = v("--color-line", "#2a2a30");
    const accent = v("--color-accent", "#ff5a0a");
    const profit = v("--color-profit", "#2fd16b");
    const loss = v("--color-loss", "#ff4d4d");
    const warn = v("--color-warn", "#f5a623");

    const chart = createChart(container.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: ink,
        fontFamily: v("--font-sans", "system-ui"),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: line, style: LineStyle.Dotted },
        horzLines: { color: line, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: accent },
        horzLine: { color: accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: accent },
      },
      localization: {
        priceFormatter: (p: number) => p.toFixed(precision),
      },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: profit,
      downColor: loss,
      wickUpColor: profit,
      wickDownColor: loss,
      borderVisible: false,
      priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
    });

    series.setData(
      bars.map((b) => ({
        time: (b.time / 1000) as UTCTimestamp,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      })),
    );

    // Levels the trade was actually taken with.
    series.createPriceLine({
      price: entryPrice,
      color: accent,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "entry",
    });
    if (stop !== null) {
      series.createPriceLine({
        price: stop,
        color: warn,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "stop",
      });
    }
    if (target !== null) {
      series.createPriceLine({
        price: target,
        color: ink,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "target",
      });
    }

    const markers = [
      {
        time: (entryTime / 1000) as UTCTimestamp,
        position: (direction === "long" ? "belowBar" : "aboveBar") as
          | "belowBar"
          | "aboveBar",
        color: accent,
        shape: (direction === "long" ? "arrowUp" : "arrowDown") as
          | "arrowUp"
          | "arrowDown",
        text: direction === "long" ? "BUY" : "SELL",
      },
    ];
    if (exitTime !== null && exitPrice !== null) {
      markers.push({
        time: (exitTime / 1000) as UTCTimestamp,
        position: (direction === "long" ? "aboveBar" : "belowBar") as
          | "belowBar"
          | "aboveBar",
        color: ink,
        shape: (direction === "long" ? "arrowDown" : "arrowUp") as
          | "arrowUp"
          | "arrowDown",
        text: "EXIT",
      });
    }
    createSeriesMarkers(series, markers);

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (container.current) {
        chart.applyOptions({ width: container.current.clientWidth });
      }
    });
    observer.observe(container.current);
    chart.applyOptions({ width: container.current.clientWidth });

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, direction, entryTime, entryPrice, exitTime, exitPrice, stop, target, precision, height]);

  if (bars.length === 0) {
    return (
      <div
        className="grid place-items-center rounded-[var(--radius-tile)] border border-dashed border-[var(--color-line-strong)] text-sm text-[var(--color-ink-mute)]"
        style={{ height }}
      >
        No candle data available for this window.
      </div>
    );
  }

  return <div ref={container} className="w-full" />;
}
