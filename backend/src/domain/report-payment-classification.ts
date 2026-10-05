export type ReportPaymentGroup = {
  method: string;
  amount: string | number;
  count: number;
};

export type ReportCashChannelGroup = {
  channel: string;
  amount: string | number;
  count: number;
};

type RevenueBucket = { amount: number; payments: number };

function toAmount(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function sumGroups<T extends { amount: string | number; count: number }>(
  groups: T[],
  include: (group: T) => boolean
): RevenueBucket {
  return groups.reduce<RevenueBucket>((total, group) => {
    if (!include(group)) return total;
    total.amount += toAmount(group.amount);
    total.payments += group.count;
    return total;
  }, { amount: 0, payments: 0 });
}

/**
 * Current operations accept CASH only. Historical methods remain visible in
 * separate audit buckets so old PayMongo or counter records are never
 * mislabeled as current cash revenue.
 */
export function classifyReportPaymentRevenue(input: {
  methodGroups: ReportPaymentGroup[];
  cashChannelGroups: ReportCashChannelGroup[];
}) {
  const cash = sumGroups(input.methodGroups, (group) => group.method === "CASH");
  const legacyOnline = sumGroups(input.methodGroups, (group) => group.method === "PAYMONGO_GCASH");
  const legacyInPerson = sumGroups(
    input.methodGroups,
    (group) => group.method !== "CASH" && group.method !== "PAYMONGO_GCASH"
  );
  const inPerson = sumGroups(input.methodGroups, (group) => group.method !== "PAYMONGO_GCASH");
  const commissaryCash = sumGroups(input.cashChannelGroups, (group) => group.channel === "COMMISSARY");
  const treasuryCash = sumGroups(input.cashChannelGroups, (group) => group.channel === "TREASURER");

  return { cash, commissaryCash, treasuryCash, inPerson, legacyOnline, legacyInPerson };
}
