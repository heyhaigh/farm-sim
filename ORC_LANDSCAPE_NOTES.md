# Orc Landscape — art spec (user, 2026-07-12) & implementation

Orc towns (`world.culture === 'orc'`) render a rocky, scorched-desert biome instead of the green farm.
Everything below is **display-only** and gated on culture (no rng, determinism safe) EXCEPT the dragon-bone
obstacle, which adds an impassable tile placed by seeded rng (orc-only, so human baselines are untouched).

## Layers
1. **Ground** ✅ DONE (commit) — `bakeChunk`: desert palette (warm baked earth, redder in summer, dust-bleached
   winter), dusty pebble speckle instead of florals, green grass-tuft decals skipped.
2. **Trees** (T.TREE) → dead + fungal, variety by hash:
   - `White_tree1/2` (pale dead branching) · `White-red_mushroom1/2/3` (pink mushroom-trees) ·
     `Chanterelles1/2/3` (orange). Pack: `craftpix-505052-forest-objects/PNG/Assets/`.
   - Keep the CHOP mechanic (orcs quarry these for wood) and crows still hop tree→tree (unchanged).
3. **Foliage** (T.FLOWER / T.WHEAT bushes) → ground mushrooms:
   - `Black_mushrooms1/2` (FLOWER) · `Orange_mushrooms1/2` (WHEAT). Pack:
     `craftpix-639143-rocky-area/PNG/Objects_separately/*_ground_shadow.png`.
4. **Rocks** (T.ROCK) → `Rock8_1..5` (magma, glowing orange) + `Rock7_1..5`. Pack:
   `craftpix-974061-rocks-and-stones/PNG/Objects_separately/`.
5. **Homes** → cave dwellings: L2 = `Cave_entrance3_ground_shadow` (plain cave mouth),
   L3 = `Cave_entrance2_ground_shadow` (SKULL cave). Same rocky pack. (L1 = default/small.)
6. **Dragon-bone skeletons** — RARE spooky decor scattered by seeded rng: `Dragon_bones_full/body/tail/
   wing1/wing2_ground_shadow` (rocky pack). MUST be impassable (collision) and NOT choppable/harvestable —
   pure obstacle. New tile `T.BONES`, orc-world-gen only.

## Asset base paths
- rocks: `assets/craftpix-net-974061-free-rocks-and-stones-top-down-pixel-art/PNG/Objects_separately/`
- forest trees/mush: `assets/craftpix-net-505052-free-forest-objects-top-down-pixel-art/PNG/Assets/`
- rocky (ground-mush / caves / bones): `assets/craftpix-net-639143-free-rocky-area-objects-pixel-art/PNG/Objects_separately/` (use the `*_ground_shadow` variants — orc ground isn't grass)
