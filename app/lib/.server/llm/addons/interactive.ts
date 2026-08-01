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

    5. Respect the rendering math: the y-axis points DOWN in both SVG and canvas, and canvas angles are in RADIANS with positive = clockwise on screen. Convert degrees at the boundary and state the conversion in a comment.

    6. rotate()/transform act around the ORIGIN, not the shape's center: translate to the pivot, rotate, translate back (or set an explicit transform-origin) — a rotation around the wrong point flings the shape off-screen.

    7. When a viewBox is set, ALL coordinates live in viewBox units, not pixels — compute positions in viewBox space and let the browser scale.

    8. Measure text before placing it: use ctx.measureText (canvas) or estimate width ≈ 0.6 × font-size × character count (SVG), then inset labels by at least half that width from the edges.
</interactive_conventions>
`;
