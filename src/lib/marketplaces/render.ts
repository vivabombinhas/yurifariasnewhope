/**
 * Per-marketplace listing renderer.
 *
 * Takes the rich product data (structured item specifics, condition,
 * shipping notes, description) and produces the output shape each
 * marketplace expects.
 *
 * - eBay: keeps `aspects` separate (Sell API requires them) and renders
 *   description as HTML sections.
 * - Etsy / Poshmark / Depop / Facebook Marketplace: concatenate everything
 *   into plain text — these marketplaces don't accept structured aspects.
 */

import type { MarketplaceId } from "@/lib/marketplaces";

export type ItemSpecific = { name: string; value: string };

export type RenderableProduct = {
  title: string;
  description: string;
  condition?: string | null;
  condition_grade?: string | null;
  condition_notes?: string | null;
  shipping_notes?: string | null;
  item_specifics?: ItemSpecific[] | null;
  brand?: { name: string } | null;
  category?: { name: string } | null;
};

export type RenderedListing = {
  marketplace: MarketplaceId;
  title: string;
  /** Final description body the marketplace will display. */
  description: string;
  /** Only set for marketplaces with structured specifics (eBay aspects). */
  aspects?: Record<string, string[]>;
};

function specifics(p: RenderableProduct): ItemSpecific[] {
  return (p.item_specifics ?? []).filter(
    (s) => s && s.name?.trim() && s.value?.trim(),
  );
}

function bulletLines(items: ItemSpecific[]): string {
  return items.map((s) => `• ${s.name}: ${s.value}`).join("\n");
}

/** eBay: HTML body + structured aspects map. */
function renderEbay(p: RenderableProduct): RenderedListing {
  const aspects: Record<string, string[]> = {};
  for (const s of specifics(p)) aspects[s.name] = [s.value];
  if (p.brand?.name && !aspects["Brand"]) aspects["Brand"] = [p.brand.name];

  const sections: string[] = [];
  if (p.description?.trim()) {
    sections.push(`<p>${escapeHtml(p.description.trim()).replace(/\n/g, "<br/>")}</p>`);
  }
  if (p.condition_grade || p.condition_notes) {
    sections.push(
      `<h3>Condition</h3><p>${[p.condition_grade, p.condition_notes]
        .filter(Boolean)
        .map((s) => escapeHtml(s!))
        .join(" — ")}</p>`,
    );
  }
  if (p.shipping_notes?.trim()) {
    sections.push(`<h3>Shipping &amp; Handling</h3><p>${escapeHtml(p.shipping_notes.trim())}</p>`);
  }

  return {
    marketplace: "ebay",
    title: p.title,
    description: sections.join("\n"),
    aspects,
  };
}

/** Plain-text concatenation for marketplaces without structured aspects. */
function renderPlainText(id: MarketplaceId, p: RenderableProduct): RenderedListing {
  const parts: string[] = [];
  if (p.description?.trim()) parts.push(p.description.trim());

  const specs = specifics(p);
  if (specs.length) {
    parts.push(`Details:\n${bulletLines(specs)}`);
  }

  if (p.condition_grade || p.condition_notes) {
    const cond = [p.condition_grade, p.condition_notes].filter(Boolean).join(" — ");
    parts.push(`Condition: ${cond}`);
  }
  if (p.shipping_notes?.trim()) {
    parts.push(`Shipping: ${p.shipping_notes.trim()}`);
  }

  return {
    marketplace: id,
    title: p.title,
    description: parts.join("\n\n"),
  };
}

export function renderListing(
  marketplace: MarketplaceId,
  p: RenderableProduct,
): RenderedListing {
  switch (marketplace) {
    case "ebay":
      return renderEbay(p);
    default:
      return renderPlainText(marketplace, p);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const DESCRIPTION_MAX_CHARS = 900;
