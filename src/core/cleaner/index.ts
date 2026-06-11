import { generateWithClaude } from "../ai/claude-cli.js"
import fs from 'fs/promises'
import prompt from "./prompt.txt"
import { checkTokenBudget, overBudgetWarning } from "../../utils/token-guard.js"
import type { VariantContext } from "../figma/variant-collapse.js"

export interface CleanupOptions {
    /**
     * When present, the code is treated as ONE representative variant of a
     * component set and the AI is asked to emit a single parametrized
     * component driven by the given variant axes (instead of one block per
     * variant).
     */
    variantContext?: VariantContext
}

/**
 * Build the parametrization instruction appended to the base cleanup prompt
 * when collapsing a component set into a single parametrized component.
 */
function buildVariantInstruction(ctx: VariantContext): string {
    const axes = Object.entries(ctx.variantAxes)
        .map(([key, values]) => `- ${key}: ${values.join(', ')}`)
        .join('\n')

    return `

## Component-set parametrization (IMPORTANT)

The code above contains one or more representative variant SAMPLES of a Figma component set named "${ctx.componentName}". Each sample is preceded by a comment "Variant sample: <variant props>" telling you which variant it is.
Do NOT emit one block per variant. Produce ONE parametrized, reusable React component named ${ctx.componentName} whose appearance is driven by props derived from these variant axes:

${axes}

Rules:
- Map each variant axis to a typed prop (a string union of the axis values, lowercased/idiomatic).
- Drive styling through props / conditional classNames / CSS — do NOT duplicate the markup per variant.
- Read the REAL colors, borders, and per-state styling from the provided samples for each axis value (e.g. each family's fill, hover/active/disabled treatment). Do NOT invent colors — if a sample exists for a value, use its actual values; only the samples are ground truth.
- Keep the structure (layout, icon slots, label) shared across the samples.
- Choose sensible defaults for each prop.

State semantics (apply precisely):
- "Loading" keeps the variant's OWN colors/fill — it is NOT the disabled look. While loading: replace the leading icon with a spinner, set aria-busy="true", and suppress clicks, but render the normal variant background and text. Never apply the disabled styling when only loading is true.
- "Disabled" uses the disabled treatment, sets the disabled attribute and aria-disabled="true". For ghost/tertiary families dim the text only (no surface fill).

Tailwind / code hygiene:
- Use ONLY valid Tailwind utility classes. Never invent utilities such as "gap-inherit". Put gap-* directly on the flex container that holds the icon and label.
- Do NOT combine px-* with ps-*/pe-* on the same element — they conflict. When applying the optical icon-side padding, set the full horizontal padding for that size using ps-* and pe-* together, instead of layering on top of px-*.
- Default the native button \`type\` to "button" unless the caller overrides it.
${ctx.spec ? `\nUse the following design-system spec as additional source of truth for the prop contract, naming and token usage (prefer the samples' concrete values for colors):\n\n${ctx.spec}\n` : ''}`
}

export const cleanupGeneratedCodeToReadable = async (
    code: string,
    options: CleanupOptions = {}
): Promise<string> => {
    try {
        const system = options.variantContext
            ? prompt + buildVariantInstruction(options.variantContext)
            : prompt
        const userPrompt = `Here is the code to clean:\n\n<vibe-code>\n${code}\n</vibe-code>`

        const budget = checkTokenBudget(system + userPrompt)
        if (!budget.withinBudget) {
            console.warn(overBudgetWarning('AI cleanup', budget))
            return code
        }

        const responseText = await generateWithClaude(system, userPrompt)

        const codeMatch = responseText.match(/<vibe-code>([\s\S]*?)<\/vibe-code>/);

        if (!codeMatch || !codeMatch[1]) {
            console.warn('AI response did not contain <vibe-code> tags, returning raw response');
            return code
        }

        return codeMatch[1].trim();
    } catch (e) {
        console.error('Error during code cleanup:', e);
        return code
    }
}
