import type { LanguageModelUsage } from "ai";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type WesbotAiUsageStatus = "SUCCESS" | "ERROR" | "BUDGET_BLOCKED";
export type WesbotBudgetHealth = "HEALTHY" | "WATCH" | "CRITICAL" | "PAUSED" | "DISABLED";
export type WesbotAiOperation = "SEMANTIC_ROUTING" | "GROUNDED_REPLY";

type UsageRecordInput = {
  status: WesbotAiUsageStatus;
  latencyMs: number;
  usage?: LanguageModelUsage;
  errorCode?: string | null;
  operation?: WesbotAiOperation;
};

type DailyUsageRow = {
  day: string;
  calls: number;
  successfulCalls: number;
  fallbackCalls: number;
  inputTokens: bigint | number;
  outputTokens: bigint | number;
  estimatedSpendUsd: unknown;
};

let persistenceWarningLogged = false;

function nonNegativeInteger(value: number | undefined) {
  return Math.max(0, Math.trunc(value ?? 0));
}

function numericDatabaseValue(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (value && typeof value === "object" && "toString" in value) {
    return Number(String(value)) || 0;
  }
  return 0;
}

function manilaDateParts(value: Date) {
  const shifted = new Date(value.getTime() + MANILA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate()
  };
}

export function wesbotUsageMonthRange(now = new Date()) {
  const { year, month } = manilaDateParts(now);
  return {
    start: new Date(Date.UTC(year, month, 1) - MANILA_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - MANILA_OFFSET_MS)
  };
}

function manilaTodayStart(now = new Date()) {
  const { year, month, day } = manilaDateParts(now);
  return new Date(Date.UTC(year, month, day) - MANILA_OFFSET_MS);
}

function manilaDayKey(value: Date) {
  return new Date(value.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

export function estimateWesbotCostUsd(input: { inputTokens?: number; outputTokens?: number }) {
  const inputCost = nonNegativeInteger(input.inputTokens) * env.WESBOT_INPUT_USD_PER_1M_TOKENS / 1_000_000;
  const outputCost = nonNegativeInteger(input.outputTokens) * env.WESBOT_OUTPUT_USD_PER_1M_TOKENS / 1_000_000;
  return inputCost + outputCost;
}

export function wesbotBudgetHealth(input: { enabled: boolean; spentUsd: number; budgetUsd: number }): WesbotBudgetHealth {
  if (!input.enabled) return "DISABLED";
  if (input.spentUsd >= input.budgetUsd) return "PAUSED";
  const percent = input.budgetUsd > 0 ? input.spentUsd / input.budgetUsd : 1;
  if (percent >= 0.9) return "CRITICAL";
  if (percent >= 0.8) return "WATCH";
  return "HEALTHY";
}

export class WesbotAiBudgetExceededError extends Error {
  constructor() {
    super("WesBot monthly AI budget reached.");
    this.name = "WesbotAiBudgetExceededError";
  }
}

export function wesbotAiErrorCode(error: unknown) {
  const seen = new Set<unknown>();
  const fragments: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      fragments.push(current.name, current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      fragments.push(String(record.statusCode ?? ""), String(record.status ?? ""), String(record.code ?? ""));
      current = record.cause;
      continue;
    }
    fragments.push(String(current));
    break;
  }

  const detail = fragments.join(" ");
  if (/429|resource[_\s-]?exhausted|quota|rate limit/i.test(detail)) return "RATE_LIMITED";
  if (/timeout|timed out|abort/i.test(detail)) return "TIMEOUT";
  if (/401|403|api.?key|permission|unauthor/i.test(detail)) return "AUTHENTICATION";
  if (/schema|validation|parse|no object generated/i.test(detail)) return "INVALID_RESPONSE";
  return "PROVIDER_ERROR";
}

function warnPersistenceOnce(error: unknown) {
  if (persistenceWarningLogged) return;
  persistenceWarningLogged = true;
  const errorName = error instanceof Error ? error.name : "unknown";
  console.warn(`WesBot AI usage tracking is unavailable (${errorName}); AI routing will continue fail-open.`);
}

async function currentMonthSpendUsd() {
  const range = wesbotUsageMonthRange();
  const aggregate = await prisma.wesbotAiUsage.aggregate({
    where: { createdAt: { gte: range.start, lt: range.end } },
    _sum: { estimatedCostUsd: true }
  });
  return numericDatabaseValue(aggregate._sum.estimatedCostUsd);
}

export async function assertWesbotAiBudgetAvailable() {
  if (!env.WESBOT_BUDGET_ENFORCEMENT_ENABLED) return;
  try {
    if (await currentMonthSpendUsd() >= env.WESBOT_MONTHLY_BUDGET_USD) {
      throw new WesbotAiBudgetExceededError();
    }
  } catch (error) {
    if (error instanceof WesbotAiBudgetExceededError) throw error;
    warnPersistenceOnce(error);
  }
}

export async function recordWesbotAiUsage(input: UsageRecordInput) {
  const inputTokens = nonNegativeInteger(input.usage?.inputTokens);
  const outputTokens = nonNegativeInteger(input.usage?.outputTokens);
  const totalTokens = nonNegativeInteger(input.usage?.totalTokens) || inputTokens + outputTokens;
  const estimatedCostUsd = input.status === "BUDGET_BLOCKED"
    ? 0
    : estimateWesbotCostUsd({ inputTokens, outputTokens });

  try {
    await prisma.wesbotAiUsage.create({
      data: {
        model: env.WESBOT_MODEL,
        operation: input.operation ?? "SEMANTIC_ROUTING",
        status: input.status,
        errorCode: input.errorCode ?? null,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: estimatedCostUsd.toFixed(8),
        latencyMs: nonNegativeInteger(input.latencyMs)
      }
    });
  } catch (error) {
    warnPersistenceOnce(error);
  }
}

export async function getWesbotAiUsageSummary(now = new Date()) {
  const month = wesbotUsageMonthRange(now);
  const todayStart = manilaTodayStart(now);
  const trendStart = new Date(todayStart.getTime() - 29 * DAY_MS);

  const [aggregate, statusGroups, errorGroups, lastSuccess, dailyRows] = await Promise.all([
    prisma.wesbotAiUsage.aggregate({
      where: { createdAt: { gte: month.start, lt: month.end } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCostUsd: true },
      _avg: { latencyMs: true }
    }),
    prisma.wesbotAiUsage.groupBy({
      by: ["status"],
      where: { createdAt: { gte: month.start, lt: month.end } },
      _count: { _all: true }
    }),
    prisma.wesbotAiUsage.groupBy({
      by: ["errorCode"],
      where: { createdAt: { gte: month.start, lt: month.end }, status: { not: "SUCCESS" } },
      _count: { _all: true }
    }),
    prisma.wesbotAiUsage.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    }),
    prisma.$queryRaw<DailyUsageRow[]>`
      SELECT
        TO_CHAR("created_at" AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS "day",
        COUNT(*)::integer AS "calls",
        COUNT(*) FILTER (WHERE "status" = 'SUCCESS')::integer AS "successfulCalls",
        COUNT(*) FILTER (WHERE "status" <> 'SUCCESS')::integer AS "fallbackCalls",
        COALESCE(SUM("input_tokens"), 0)::bigint AS "inputTokens",
        COALESCE(SUM("output_tokens"), 0)::bigint AS "outputTokens",
        COALESCE(SUM("estimated_cost_usd"), 0) AS "estimatedSpendUsd"
      FROM "wesbot_ai_usage"
      WHERE "created_at" >= ${trendStart}
        AND "created_at" < ${new Date(todayStart.getTime() + DAY_MS)}
      GROUP BY 1
      ORDER BY 1 ASC
    `
  ]);

  const statusCounts = new Map(statusGroups.map((row) => [row.status, row._count._all]));
  const errorCounts = new Map(errorGroups.map((row) => [row.errorCode ?? "UNKNOWN", row._count._all]));
  const estimatedSpendUsd = numericDatabaseValue(aggregate._sum.estimatedCostUsd);
  const budgetUsd = env.WESBOT_MONTHLY_BUDGET_USD;
  const remainingUsd = Math.max(0, budgetUsd - estimatedSpendUsd);
  const budgetPercent = budgetUsd > 0 ? estimatedSpendUsd / budgetUsd * 100 : 100;
  const dailyByDay = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = Array.from({ length: 30 }, (_, index) => {
    const day = manilaDayKey(new Date(trendStart.getTime() + index * DAY_MS));
    const row = dailyByDay.get(day);
    return {
      day,
      calls: row?.calls ?? 0,
      successfulCalls: row?.successfulCalls ?? 0,
      fallbackCalls: row?.fallbackCalls ?? 0,
      inputTokens: numericDatabaseValue(row?.inputTokens),
      outputTokens: numericDatabaseValue(row?.outputTokens),
      estimatedSpendUsd: numericDatabaseValue(row?.estimatedSpendUsd)
    };
  });
  const today = daily.at(-1) ?? {
    day: manilaDayKey(todayStart),
    calls: 0,
    successfulCalls: 0,
    fallbackCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedSpendUsd: 0
  };

  return {
    model: env.WESBOT_MODEL,
    aiEnabled: env.WESBOT_AI_ENABLED,
    semanticMode: env.WESBOT_SEMANTIC_MODE,
    budgetEnforced: env.WESBOT_BUDGET_ENFORCEMENT_ENABLED,
    budgetUsd,
    estimatedSpendUsd,
    remainingUsd,
    budgetPercent,
    budgetHealth: wesbotBudgetHealth({
      enabled: env.WESBOT_AI_ENABLED,
      spentUsd: estimatedSpendUsd,
      budgetUsd
    }),
    monthStart: month.start.toISOString(),
    monthEnd: month.end.toISOString(),
    totalCalls: aggregate._count._all,
    successfulCalls: statusCounts.get("SUCCESS") ?? 0,
    fallbackCalls: (statusCounts.get("ERROR") ?? 0) + (statusCounts.get("BUDGET_BLOCKED") ?? 0),
    budgetBlockedCalls: statusCounts.get("BUDGET_BLOCKED") ?? 0,
    rateLimitedCalls: errorCounts.get("RATE_LIMITED") ?? 0,
    timeoutCalls: errorCounts.get("TIMEOUT") ?? 0,
    inputTokens: aggregate._sum.inputTokens ?? 0,
    outputTokens: aggregate._sum.outputTokens ?? 0,
    totalTokens: aggregate._sum.totalTokens ?? 0,
    averageLatencyMs: Math.round(aggregate._avg.latencyMs ?? 0),
    lastSuccessAt: lastSuccess?.createdAt.toISOString() ?? null,
    today,
    daily
  };
}
