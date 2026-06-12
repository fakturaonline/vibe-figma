# Component Sets, Variant Collapse & the Token Guard

This page explains how VibeFigma converts large Figma **component sets** (a component with many variants) without overflowing the LLM token limit — and the safety net that keeps a run from crashing even when something is too big to send.

## The problem

A design-system component is usually a single Figma **component set** containing every variant combination. A Button, for example, can be:

```
6 families (Brand, Primary, Secondary, Tertiary, Danger, Success)
× 5 sizes   (XS, S, M, L, XL)
× 6 states  (Default, Hover, Active, Focus, Disabled, Loading)
≈ 180 variants
```

Converting the set naively walks the **whole** node tree, so all ~180 variants become ~180 near-identical JSX subtrees. That single payload is then sent to Gemini for cleanup / framework mapping. The result:

- the request exceeds the model's token limit (or the free-tier per-minute budget) and **the run crashes**, and
- even if it didn't, paying to send 180 copies of the same markup is wasteful.

## The fix: two layers

### Layer 1 — Token guard (always on)

Before every Gemini call (AI cleanup, shadcn/MUI mapping, color mapping) VibeFigma estimates the payload size (~4 chars/token) and compares it to `MAX_AI_INPUT_TOKENS`.

- **Within budget** → the call proceeds normally.
- **Over budget** → the AI step is **skipped** with a clear warning and the un-transformed code is kept.

So the conversion **degrades gracefully instead of crashing**. You still get output (the raw/un-cleaned JSX) plus a message telling you what to do next.

```
[token-guard] Payload ~430k tokenů přesahuje limit 60k — AI cleanup přeskočen, použit raw vstup.
Zacil URL na jednu konkrétní variantu, zapni --collapse-variants, nebo zvyš MAX_AI_INPUT_TOKENS.
```

#### Tuning for your Gemini tier

`MAX_AI_INPUT_TOKENS` (env var, default **60000**) is tuned for a **free Gemini API key**.

The binding constraint on the free tier is the **per-minute token budget (TPM)** — roughly ~250k tokens/min for Flash models (check current numbers at <https://ai.google.dev/gemini-api/docs/rate-limits>). A single conversion run can fire **up to three** Gemini calls (cleanup + framework mapping + color mapping) within the same minute, all drawing from that one budget. A per-call ceiling of ~60k keeps a full run comfortably under the free-tier minute limit, leaving room for the system prompt and the model's output.

On a **paid tier** you can raise it:

```bash
MAX_AI_INPUT_TOKENS=400000
```

### Layer 2 — Variant collapse (`--collapse-variants`)

The real fix for component sets. When enabled, VibeFigma:

1. Detects the `COMPONENT_SET` in the imported node (recursively, in case the URL points at a page).
2. Reads the **variant axes** from the set's `componentPropertyDefinitions` — falling back to parsing the variant names (`Variant=Brand, Size=M, State=Default`).
3. Selects a small, **color-covering sample** of variants instead of all of them (see below).
4. Converts only those samples to JSX — typically ~5–40 variants instead of ~180.
5. Passes the samples (each labelled with its variant props) + the variant axes (+ optional spec) to the AI cleanup step, asking it to emit **one parametrized component** whose appearance is driven by props, e.g. `<Button variant size state>`.

This mirrors how the component should exist in code anyway: one component, variants as props.

#### Why a sample (not a single variant) — `--variant-samples`

A single variant only exposes one family's colors, so the AI has to *guess* every other family / hover / active / disabled color and usually gets them wrong. To avoid that, VibeFigma holds the **dimensional axis** (Size — it carries no color) fixed at its default and takes the cross-product of the remaining **color-bearing axes** (Variant × State). The AI then sees the real color for every family in every state. Dimensions stay correct because they come from the spec table, not from the sampled markup.

- `--variant-samples <n>` caps how many variant samples are rendered/sent (default **48**). More samples = better color fidelity; fewer = cheaper.
- If the color matrix exceeds the cap, sampling falls back to **one-at-a-time axis coverage** (representative + each axis value swept once).
- `--variant-samples 1` reverts to the old single-representative behavior.

### Layer 3 — Color fidelity (automatic, deterministic)

LLMs occasionally drift a color by a few units when transcribing it (e.g. `#097fb5` → `#097fb1`). For a design system that is wrong. So after the AI cleanup, VibeFigma:

1. Builds the **ground-truth palette** from the raw rendered samples (before the AI touched them).
2. Snaps every color literal in the AI output to the nearest palette color when it is within a small distance (RGB Euclidean ≤ 16).

Far-off colors and Tailwind classes are left untouched, and the design's palette colors are well separated, so this only **repairs drift** — it never merges distinct design colors. The result: colors are exactly the design's, regardless of LLM non-determinism. This runs automatically on the collapse path; a log line reports how many colors were snapped.

## Usage

```bash
# Collapse a component set into one parametrized component
npx vibefigma "https://www.figma.com/design/<file>?node-id=<set-node-id>" \
  --clean \
  --collapse-variants \
  --spec ./button.md
```

| Flag | Required | Purpose |
|---|---|---|
| `--collapse-variants` | — | Detect a component set and collapse it to a color-covering sample of variants + axes. |
| `--variant-samples <n>` | optional | Max number of variant samples sent to the AI (default 48). More = better color fidelity. |
| `--clean` | for parametrized output | The AI cleanup step is what turns the samples into one parametrized component. Without it you just get the rendered sample(s). |
| `--spec <path>` | optional | A design-system spec (markdown) handed to the AI as the source of truth for the prop contract, naming, and token usage. |

When `--collapse-variants` is set but the node is **not** a component set, VibeFigma logs a note and converts the full tree as usual — so it's safe to leave on.

### Example log

```
Detected component set "ButtonComponent" — collapsing to 36 variant sample(s)
(3 variant axes: Variant[6], Size[5], State[6])
Pre-processing to extract image nodes...
Converting to JSX...
Cleaning up generated code...
Color fidelity: snapped 1 drifted color(s) back to the design palette.
```

## What the AI is asked to produce

With a variant context present, the cleanup prompt is extended to require:

- one typed prop per variant axis (a string union of the axis values, lowercased),
- styling driven by props / conditional classNames / CSS — **not** duplicated markup per variant,
- the **real colors and per-state styling read from the samples** (no guessing),
- correct state semantics (loading keeps the family color + spinner; disabled uses the disabled treatment),
- Tailwind hygiene (valid utilities only; no `px-*` combined with `ps-*`/`pe-*`),
- `type="button"` by default,
- (if `--spec` is provided) the spec's tables as the prop/token contract.

## Configuration reference

| Setting | Where | Default | Notes |
|---|---|---|---|
| `MAX_AI_INPUT_TOKENS` | env var | `60000` | Per-call input ceiling for the token guard. Free-tier safe; raise on paid tiers. |
| `--collapse-variants` | CLI flag / `collapseVariants` (HTTP) | off | Enable component-set collapse. |
| `--variant-samples <n>` | CLI flag / `variantSamples` (HTTP) | `48` | Max variant samples sent to the AI when collapsing. |
| `--spec <path>` | CLI flag / `specPath` (HTTP) | none | Spec markdown to anchor the prop contract. |

## Alternative without code changes

If you just want to avoid the crash quickly, point the Figma URL/`node-id` at a **single variant** rather than the whole set, and hand the spec to the AI yourself. `--collapse-variants` is essentially the automation of exactly that.

## Where it lives in the code

- `src/utils/token-guard.ts` — estimation + budget check (`estimateTokens`, `checkTokenBudget`).
- `src/core/figma/variant-collapse.ts` — `collapseComponentSet()` (detection, axis extraction, color-covering sampling).
- `src/core/figma/color-fidelity.ts` — `extractPalette()` / `snapColorsToPalette()` (deterministic color repair).
- `src/core/figma/figma-react.ts` — wires collapse, sampling, and color fidelity into the pipeline.
- `src/core/cleaner/index.ts` — the parametrization prompt (`variantContext`).
- `src/core/mapping/framework-mapper-ai.ts` — token guard on the three mapping calls.
