/**
 * The 3D scene conventions section, injected only when the request involves
 * 3D rendering (three.js / react-three-fiber / WebGL — see index.ts for the
 * trigger). Targets the classic 3D failure classes: black unlit scenes,
 * hardcoded cameras that miss the subject, near/far clipping, axis/angle
 * convention errors, drag-fights-orbit interactions — plus the rendering
 * defaults that separate a toy render from a polished one.
 */
export const THREE_D_ADDON = `
<threed_conventions>
  Rules for 3D scenes (three.js / react-three-fiber / WebGL):

    1. Visibility baseline: lit materials (MeshStandardMaterial, MeshPhongMaterial, MeshLambertMaterial) render BLACK without lights — always add a hemisphere or ambient light PLUS one directional key light. State light positions in a comment.

    2. Camera framing BY CONSTRUCTION, never hardcoded guesses: compute the subject's bounds (Box3.setFromObject → getBoundingSphere), place the camera at ~2× the bounding-sphere radius on a 3/4 view, lookAt the center, and set near/far to bracket the scene (≈ radius/100 … radius×100).

    3. Conventions: three.js is y-up, right-handed, angles in RADIANS — state every axis/angle convention in a comment where it is defined.

    4. Controls: OrbitControls (or the r3f equivalent) with damping. On window resize, update BOTH the camera aspect AND the renderer size.

    5. Motion: ONE animation loop driven by delta time (or useFrame in react-three-fiber) — never setInterval-driven rendering.

    6. Overlap: never leave surfaces coplanar (z-fighting) — offset stacked surfaces by a small epsilon.

    7. Interaction: pointer-dragging an object uses raycasting; disable orbit controls while an object is dragged so the two do not fight.

    8. Graphics quality (do these by default — they are the difference between a flat toy render and a polished one):

      - Renderer: antialias on, pixelRatio capped at min(devicePixelRatio, 2), ACESFilmic tone mapping with sRGB output.
      - Lighting: hemisphere light for natural base illumination + one directional key light WITH shadows (renderer.shadowMap enabled, shadow camera bounds derived from the subject's bounds).
      - Grounding: a subtle ground plane or contact shadow so objects do not float in void; a gentle background color or gradient, never default black.
      - Materials: MeshStandardMaterial with tuned roughness/metalness whenever lights exist — not flat MeshBasicMaterial.
</threed_conventions>
`;
