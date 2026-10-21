Records the prompt and provenance of the selected Neural Pilot app icon.

# Neural Pilot app icon

Generated with the built-in `image_gen` tool on 2026-10-20 and selected as option C after comparing
three concepts on light and dark backgrounds at 16–64 px. No CLI image-generation fallback was used.

The reference was a locally rendered contact sheet of the actual chicken model used by `@ccr/render`
(`models/characters/chicken/0.obj` and its texture, fetched from the pinned upstream revision in
[NOTICE](../../NOTICE)). It guided the character's shape and colors. The icon is a newly generated raster,
with a navy contour and cyan visor for the AI identity.

The selected image was resized to a 1024 × 1024 RGBA PNG for the tracked master
`apps/desktop/src-tauri/icons/source.png`. Transparency and the selected composition are preserved.
See [desktop-app.md](../desktop-app.md#app-icon-and-favicon) for repeatable platform exports.

## Generation prompt

```text
Use case: stylized-concept.
Asset type: production app icon concept for Clef Crossy Road, used as a desktop app icon and browser favicon.
Reference image: the supplied reference.png shows the actual chicken model in this game from three angles. It is a reference for character proportions and identity only, not an image to modify. Make original icon artwork closely resembling that character.
Character invariants: instantly recognizable white block-shaped chicken, tall rectangular white head and neck merged together, short wide white cuboid body, small block wings, RED cuboid comb centered on the top, stubby ORANGE rectangular beak and red wattle, dark small square eye, orange block legs and feet. Friendly and determined, no human anatomy.
Project palette: sky blue #87c6ff, ink navy #1d2b45, warm yellow #ffd640, white and cool pale gray, red comb, orange feet. Add restrained cyan #39d4ed as an AI indicator.
Composition: exactly one centered isolated character, three-quarter view facing right, clear silhouette, optical balance, subject fills about 80% of the square image with even safe margins. This must be a usable icon, not a scene.
Scene/backdrop: true transparent alpha outside the character. No landscape, road, platform, grass, base, background plate, drop shadow, text, letters, logos, watermark, annotations, diagram, labels or second character. Never paint a checkerboard.
Quality: deliberate clean large forms, sharply defined contours, no photographic details, no smooth rounded chicken, no soft blur, no stray pixels, no tiny decorative circuit networks, no extra limbs, no detached symbols. Designed to remain recognizable at 16 and 32 pixels.
Style/medium: clean bold 2.5D voxel pixel-art app mascot. Orthographic cuboid faces and crisp stepped pixel contours, flat colors, a little hard flat shading, approximately 48 by 48 logical pixels enlarged sharply; no realistic rendering. Full chicken with orange block feet and small white cuboid wings, proportions close to the reference. Keep the red comb clearly visible. Add a slim dark navy rectangular futuristic eye visor fitted across the upper white head, with a simple single bright cyan rectangular eye slit and one small cyan temple square; no helmet, headphones or antenna. The beak stays bright orange and separate below the visor. A thin dark navy stepped exterior outline makes the white silhouette read on light and dark backgrounds. AI identity is stronger than the faithful option, but the character is still clearly the game's cubic chicken, not a humanoid robot. No chest emblem.
```
