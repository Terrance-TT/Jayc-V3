/**
 * The domain-rules prompt section, injected only when the request encodes
 * real-world rules (physics, finance, health, measurements, conventions —
 * see index.ts for the trigger). Un-parked: the verify phase only covers
 * rule checking when a Tavily key is configured, so the conventions belong
 * in the request path too.
 */
export const DOMAIN_RULES_ADDON = `
<domain_rules>
  When an app encodes real-world rules (physics, finance, health, games with rules, measurements, conventions), those rules are the easiest place to be confidently WRONG. Handle them explicitly:

    1. ONE auditable home: put ALL domain constants, lookup tables, and conventions in a single file (e.g. \`modules/shared/src/domainRules.ts\`, or the owning module's \`src/rules.ts\`) — never scatter magic numbers across components.

    2. State conventions in words: every ambiguous convention gets a comment (e.g. "wind direction = where the wind comes FROM", "angles in degrees, 0 = bow, positive clockwise", "amounts in cents, not dollars").

    3. Source each rule: when \`<web_search_results>\` is present in your instructions, ground the rules in it and say so in a comment. When it is not present, mark the rule "from general knowledge — verify" so the user knows what to double-check.

    4. Before finishing, re-derive the classic error class: direction-from vs direction-to, degrees vs radians, unit conversions, sign conventions, off-by-one ranges.
</domain_rules>
`;
