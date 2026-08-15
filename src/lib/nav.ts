import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  BookMarked,
  BookOpen,
  Boxes,
  CalendarDays,
  CandlestickChart,
  ClipboardList,
  Clock4,
  Cpu,
  Crosshair,
  FileText,
  FlaskConical,
  Gauge,
  Globe2,
  HeartPulse,
  LineChart,
  ListChecks,
  MessagesSquare,
  Radio,
  ScrollText,
  Settings,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One-line purpose, surfaced in the command palette. */
  hint: string;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

/**
 * The 24 screens, in six sidebar groups.
 *
 * Trade Detail is deliberately absent: it is a drill-down from the blotter
 * (/trades/[id]), not a sidebar destination.
 */
export const NAV: NavGroup[] = [
  {
    id: "live",
    label: "Live",
    items: [
      {
        href: "/",
        label: "Today",
        icon: Gauge,
        hint: "Live desk — today's R against limit, open risk, streaming P&L",
      },
      {
        href: "/positions",
        label: "Open Positions",
        icon: Wallet,
        hint: "What's currently on, with streaming P&L",
      },
    ],
  },
  {
    id: "daily",
    label: "Daily",
    items: [
      {
        href: "/pre-market",
        label: "Pre-Market",
        icon: ClipboardList,
        hint: "Game plan — bias, levels, news due, setups hunted",
      },
      {
        href: "/opportunities",
        label: "Best Opportunities",
        icon: Crosshair,
        hint: "Everything spotted and every AI candidate, scored",
      },
      {
        href: "/review",
        label: "End of Day",
        icon: BookOpen,
        hint: "Daily wrap, grade, rule adherence, tomorrow's prep",
      },
      {
        href: "/calendar",
        label: "Calendar",
        icon: CalendarDays,
        hint: "Month heatmap of daily P&L",
      },
    ],
  },
  {
    id: "trades",
    label: "Trades",
    items: [
      {
        href: "/trades",
        label: "Trade Log",
        icon: ListChecks,
        hint: "Every trade, filterable by book, pattern, session, outcome",
      },
      {
        href: "/patterns",
        label: "Pattern Library",
        icon: BookMarked,
        hint: "Setup definitions, context filters, management logic, live stats",
      },
      {
        href: "/backtest",
        label: "Backtest",
        icon: FlaskConical,
        hint: "Screen the pattern library against stored history, adjusted for how many were tried",
      },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    items: [
      {
        href: "/performance",
        label: "Performance",
        icon: LineChart,
        hint: "Equity curves per book, expectancy, profit factor, R distribution",
      },
      {
        href: "/pattern-performance",
        label: "Pattern Performance",
        icon: TrendingUp,
        hint: "Which setups actually make money, by book and session",
      },
      {
        href: "/sessions",
        label: "Time & Session",
        icon: Clock4,
        hint: "Performance by hour, weekday, session and hold time",
      },
      {
        href: "/instruments",
        label: "Instruments",
        icon: Boxes,
        hint: "Per-instrument performance and correlation exposure",
      },
    ],
  },
  {
    id: "risk",
    label: "Risk",
    items: [
      {
        href: "/risk",
        label: "Risk & Drawdown",
        icon: ShieldAlert,
        hint: "Risk per trade over time, drawdown depth and duration, streaks",
      },
      {
        href: "/mistakes",
        label: "Mistakes & Leaks",
        icon: Activity,
        hint: "Error taxonomy, each costed in R and trended",
      },
      {
        href: "/playbook",
        label: "Playbook",
        icon: BookOpen,
        hint: "Trading plan, rules, risk limits, pre-trade checklist",
      },
    ],
  },
  {
    id: "research",
    label: "Research",
    items: [
      {
        href: "/wire",
        label: "The Wire",
        icon: Radio,
        hint: "Live news, central banks, releases and filings — newest first",
      },
      {
        href: "/charts",
        label: "Charts",
        icon: CandlestickChart,
        hint: "TradingView — search any symbol, any timeframe",
      },
      {
        href: "/chat",
        label: "Chat",
        icon: MessagesSquare,
        hint: "Member rooms — opinions, not advice",
      },
      {
        href: "/market-context",
        label: "Market Context",
        icon: Globe2,
        hint: "Calendar, macro regime, market-implied event probabilities",
      },
      {
        href: "/watchlist",
        label: "Watchlist",
        icon: BarChart3,
        hint: "Tracked instruments, key levels and alerts",
      },
      {
        href: "/idea-lab",
        label: "Idea Lab",
        icon: FlaskConical,
        hint: "Incubate patterns on demo until they earn live capital",
      },
      {
        href: "/goals",
        label: "Goals",
        icon: Target,
        hint: "Targets, milestones, monthly and quarterly review",
      },
    ],
  },
  {
    id: "review",
    label: "Review",
    items: [
      {
        href: "/psychology",
        label: "Psychology",
        icon: HeartPulse,
        hint: "Sleep, energy, focus, emotional state and tilt markers",
      },
      {
        href: "/reports",
        label: "Reports",
        icon: FileText,
        hint: "Monthly and quarterly summaries, exports",
      },
      {
        href: "/ask",
        label: "Ask",
        icon: Sparkles,
        hint: "Question your own trading history in plain English",
      },
    ],
  },
  {
    id: "engine",
    label: "Engine",
    items: [
      {
        href: "/engine",
        label: "Engine",
        icon: Cpu,
        hint: "Arm, disarm and halt the autonomous engine, per book",
      },
      {
        href: "/orders",
        label: "Order Log",
        icon: ScrollText,
        hint: "Every order the engine considered — including the ones it refused",
      },
    ],
  },
  {
    id: "settings",
    label: "System",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        hint: "Accounts, books, risk config, models, display",
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/** Longest-prefix match, so /trades/abc123 still highlights Trade Log. */
export function activeHref(pathname: string): string {
  const matches = ALL_NAV_ITEMS.map((i) => i.href)
    .filter((href) => (href === "/" ? pathname === "/" : pathname.startsWith(href)))
    .sort((a, b) => b.length - a.length);
  return matches[0] ?? "/";
}
