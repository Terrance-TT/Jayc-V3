/**
 * PARKED — not wired into any prompt (see ../CONTRACT.md).
 *
 * The house-style design defaults, removed from the always-on prompt during
 * the golden-scope revert. A condensed version has since been promoted back
 * into the always-on prompt (product_judgment in prompts.ts); this full
 * text is kept as the reference copy.
 */
export const DESIGN_DEFAULTS_ADDON = `
<design_defaults>
  When the user does not specify a look, use this house style so every app feels intentionally designed — do NOT invent a new visual language each time:

    - Overall: clean, modern, professional — generous whitespace, clear visual hierarchy, one obvious primary action per view.
    - Color: a neutral base (white/soft gray for light palettes, deep neutral for dark ones) with ONE accent color used sparingly for primary actions and key highlights. No rainbow gradients, no multicolor chaos.
    - Typography: Inter or the system font stack; size and weight do the hierarchy work (large bold headings, quiet secondary text).
    - Shape: 8-12px border radius, subtle shadows, thin borders, consistent spacing on an 8px rhythm.
    - Layout: mobile-first responsive; content centered with sensible max-widths.

  If the user asks for a specific vibe (playful, retro, corporate, neon, …), follow THEM — these defaults only apply when they said nothing.
</design_defaults>
`;
