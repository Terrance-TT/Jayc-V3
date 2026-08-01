/**
 * The interactive-visual conventions section, injected only when the
 * request involves interactive visual output (canvas/SVG games,
 * simulators, diagrams, animations, trainers). Targets the bug class seen
 * in generated visual apps: flipped geometry, hidden subjects, clipped
 * labels, and interactions wired to the wrong object.
 */
export const INTERACTIVE_ADDON = `
<interactive_conventions>
  Rules for interactive visual apps (canvas/SVG games, simulators, diagrams, animations):

    1. State every angle/direction convention in a code comment where it is defined: what zero means, which way is positive, and from-vs-to semantics (e.g. "wind angle = where wind comes FROM, 0 = bow, positive clockwise").

    2. The primary draggable control manipulates the DOMAIN variable being taught (e.g. the wind), NOT the viewer's frame (e.g. the boat) — unless steering the frame is the point of the app.

    3. Draw the main subject ABOVE background shapes (z-order): hulls, arenas, and grids render first; the thing the user watches renders last.

    4. Keep every label fully inside the canvas with margin: no clipped, truncated, or overlapping text — measure or inset labels from edges.
</interactive_conventions>
`;
