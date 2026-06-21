/**
 * eBay Sell Metadata API — condition policies by category.
 * SERVER ONLY. Source of truth for category-specific eBay conditions.
 */
import { getValidEbayAccessToken } from "./token-service.server";

const MARKETPLACE_ID = "EBAY_US";

function metadataHost(env: string) {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export interface EbayConditionPolicy {
  categoryId: string;
  conditionRequired: boolean;
  conditionId: number;
  displayName: string;
  conditionEnum: string;
  conditionDescriptors: unknown[];
}

const CONDITION_ID_ENUMS: Record<number, string> = {
  1000: "NEW",
  1500: "NEW_OTHER",
  1750: "NEW_WITH_DEFECTS",
  2000: "CERTIFIED_REFURBISHED",
  2010: "EXCELLENT_REFURBISHED",
  2020: "VERY_GOOD_REFURBISHED",
  2030: "GOOD_REFURBISHED",
  2500: "SELLER_REFURBISHED",
  2750: "LIKE_NEW",
  2990: "PRE_OWNED_EXCELLENT",
  3000: "USED_EXCELLENT",
  3010: "USED_ACCEPTABLE",
  4000: "USED_VERY_GOOD",
  5000: "USED_GOOD",
  6000: "USED_ACCEPTABLE",
  7000: "FOR_PARTS_OR_NOT_WORKING",
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

export function conditionEnumForPolicy(conditionId: number, displayName: string): string {
  const byId = getConditionEnumForId(conditionId);
  if (byId) return byId;
  const name = normalize(displayName);
  if (name === "new with defects") return "NEW_WITH_DEFECTS";
  if (name === "new" || name === "new with box" || name === "new with tags") return "NEW";
  if (name === "new other" || name === "new without box" || name === "new without tags") return "NEW_OTHER";
  if (name === "used" || name === "pre owned" || name === "pre-owned") return "USED_GOOD";
  if (name.includes("excellent")) return "USED_EXCELLENT";
  if (name.includes("fair") || name.includes("acceptable")) return "USED_ACCEPTABLE";
  return displayName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function getConditionEnumForId(conditionId: number): string | null {
  return CONDITION_ID_ENUMS[conditionId] ?? null;
}

export function assertConditionIdEnumMatch(conditionId: number, conditionEnum: string) {
  const canonicalEnum = getConditionEnumForId(conditionId);
  if (canonicalEnum !== conditionEnum) {
    throw new Error(
      JSON.stringify({
        code: "EBAY_CONDITION_ID_ENUM_MISMATCH",
        message: "eBay conditionId and conditionEnum do not match the canonical map.",
        conditionId,
        providedConditionEnum: conditionEnum,
        canonicalConditionEnum: canonicalEnum,
      }),
    );
  }
}

export async function getEbayConditionPolicies(categoryId: string): Promise<EbayConditionPolicy[]> {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();
  const params = new URLSearchParams({ filter: `categoryIds:{${categoryId}}` });
  const url = `${metadataHost(env)}/sell/metadata/v1/marketplace/${MARKETPLACE_ID}/get_item_condition_policies?${params}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBay condition policies ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    itemConditionPolicies?: Array<{
      categoryId: string;
      itemConditionRequired?: boolean;
      itemConditions?: Array<{
        conditionId: string;
        conditionDescription: string;
        conditionDescriptors?: unknown[];
      }>;
    }>;
  };

  // Only accept a policy whose categoryId exactly matches. Falling back to
  // itemConditionPolicies[0] returns a sibling category's policy and lets
  // invalid conditionIds (e.g. 2750 LIKE_NEW for cat 95672) pass pre-audit
  // only to be rejected by /publish with errorId 25059.
  const policy = (json.itemConditionPolicies ?? []).find(
    (p) => String(p.categoryId) === String(categoryId),
  );

  return (policy?.itemConditions ?? []).map((c) => {
    const conditionId = Number(c.conditionId);
    const displayName = c.conditionDescription;
    return {
      categoryId: policy?.categoryId ?? categoryId,
      conditionRequired: !!policy?.itemConditionRequired,
      conditionId,
      displayName,
      conditionEnum: conditionEnumForPolicy(conditionId, displayName),
      conditionDescriptors: c.conditionDescriptors ?? [],
    };
  });
}

export function suggestEbayConditionPolicy(
  policies: EbayConditionPolicy[],
  internalCondition: string | null | undefined,
  conditionGrade: string | null | undefined,
  conditionNotes: string | null | undefined,
): EbayConditionPolicy | null {
  if (!policies.length || !internalCondition) return null;
  const text = normalize(`${conditionGrade ?? ""} ${conditionNotes ?? ""}`);
  const hasDefect = /\b(defect|factory second|irregular|flaw|damaged|damage|stain|hole|tear|scuff|scratch|crack|broken)\b/.test(text);
  const hasBoxOrTag = /\b(with box|original box|in box|with tags|tag attached|tags attached|new with tags)\b/.test(text);
  const lacksBoxOrTag = /\b(without box|no box|missing box|without tags|no tags|missing tags)\b/.test(text);
  const byEnum = (enums: string[]) =>
    policies.find((p) => enums.includes(p.conditionEnum)) ?? null;
  const byName = (names: string[]) =>
    policies.find((p) => names.some((n) => normalize(p.displayName).includes(n))) ?? null;

  if (internalCondition === "new") {
    if (hasDefect) return byEnum(["NEW_WITH_DEFECTS"]) ?? byName(["defect"]);
    if (hasBoxOrTag) return byEnum(["NEW_WITH_BOX", "NEW_WITH_TAGS", "NEW"]);
    if (lacksBoxOrTag) return byEnum(["NEW_WITHOUT_BOX", "NEW_WITHOUT_TAGS", "NEW_OTHER"]);
    const newOptions = policies.filter((p) => p.conditionEnum.startsWith("NEW"));
    return newOptions.length === 1 ? newOptions[0]! : null;
  }

  if (internalCondition === "like_new") {
    return byEnum([
      "LIKE_NEW",
      "PRE_OWNED_EXCELLENT",
      "USED_EXCELLENT",
      "USED_VERY_GOOD",
      "USED_GOOD",
      "PRE_OWNED",
    ]);
  }
  if (internalCondition === "very_good") {
    return byEnum(["USED_VERY_GOOD", "USED_GOOD", "USED_EXCELLENT", "PRE_OWNED"]);
  }
  if (internalCondition === "good") {
    return byEnum(["USED_GOOD", "USED_VERY_GOOD", "USED_EXCELLENT", "PRE_OWNED"]);
  }
  if (internalCondition === "acceptable") {
    return byEnum([
      "USED_ACCEPTABLE",
      "PRE_OWNED_FAIR",
      "USED_GOOD",
      "USED_VERY_GOOD",
      "USED_EXCELLENT",
      "PRE_OWNED",
    ]);
  }
  if (internalCondition === "for_parts") {
    return byEnum(["FOR_PARTS_OR_NOT_WORKING", "USED_ACCEPTABLE", "USED_GOOD"]);
  }
  return null;
}