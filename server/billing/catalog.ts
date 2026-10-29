export const UNIT_MICRO_USD = 10000;
export const plans = {
  free: {
    name: "Free",
    units: 20,
    quality: "low",
    batch: 0,
    images: 10,
    storage: 25 * 1048576,
    projects: 3,
    description: "One considered first edit.",
  },
  starter: {
    name: "Starter",
    units: 100,
    quality: "medium",
    batch: 3,
    images: 100,
    storage: 250 * 1048576,
    projects: 100,
    description: "A steady rhythm for independent creators.",
  },
  pro: {
    name: "Pro",
    units: 250,
    quality: "high",
    batch: 5,
    images: 100,
    storage: 250 * 1048576,
    projects: 100,
    description: "More room for your next collection.",
  },
  payg: {
    name: "Pay as you go",
    units: 0,
    quality: "medium",
    batch: 0,
    images: 100,
    storage: 250 * 1048576,
    projects: 100,
    description: "Create when you need to.",
  },
} as const;
export const offers = {
  free: { plan: "free", kind: "free", interval: "once", cents: 0, units: 20 },
  starter_monthly: {
    plan: "starter",
    kind: "subscription",
    interval: "month",
    cents: 900,
    units: 100,
  },
  starter_annual: {
    plan: "starter",
    kind: "subscription",
    interval: "year",
    cents: 8640,
    units: 1200,
  },
  pro_monthly: {
    plan: "pro",
    kind: "subscription",
    interval: "month",
    cents: 1900,
    units: 250,
  },
  pro_annual: {
    plan: "pro",
    kind: "subscription",
    interval: "year",
    cents: 18240,
    units: 3000,
  },
  small_pack: {
    plan: "payg",
    kind: "one_time",
    interval: "once",
    cents: 500,
    units: 50,
  },
  studio_pack: {
    plan: "payg",
    kind: "one_time",
    interval: "once",
    cents: 1500,
    units: 200,
  },
} as const;
export type OfferId = keyof typeof offers;
export const offerIds = Object.keys(offers) as OfferId[];
export function offer(id: string) {
  if (!Object.hasOwn(offers, id)) throw Error("invalid_offer");
  return offers[id as OfferId];
}
export function amount(cents: number) {
  return (cents / 100).toFixed(2);
}
