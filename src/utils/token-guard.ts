/**
 * Token guard — cheap pre-flight size check before sending a payload to an LLM.
 *
 * Uses a heuristic of ~4 characters per token so we never need to pull in a
 * real tokenizer dependency. The goal is not exact accounting but a hard
 * ceiling that prevents an over-limit request from ever reaching Gemini —
 * which would otherwise crash the whole conversion (e.g. a component set with
 * dozens of variants rendered into one giant JSX blob).
 *
 * The limit can be overridden with the MAX_AI_INPUT_TOKENS env var. We read it
 * directly from process.env (rather than the zod-validated config) so this
 * module stays decoupled from the HTTP-only config and can be used safely from
 * the core conversion pipeline.
 *
 * Default (60k) is tuned for a FREE Gemini API key. The binding constraint on
 * the free tier is the per-minute token budget (TPM — roughly ~250k tokens/min
 * for Flash; check current quotas at https://ai.google.dev/gemini-api/docs/rate-limits).
 * One conversion run can issue up to 3 Gemini calls (cleanup + framework + color
 * mapping) within the same minute, all sharing that budget, so a per-call ceiling
 * of ~60k keeps a full run under the free-tier minute limit with margin for output.
 * On a paid tier, raise MAX_AI_INPUT_TOKENS.
 */

const DEFAULT_MAX_AI_INPUT_TOKENS = 60_000;

export function getMaxAiInputTokens(): number {
  const raw = process.env.MAX_AI_INPUT_TOKENS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_AI_INPUT_TOKENS;
}

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface TokenBudgetCheck {
  withinBudget: boolean;
  estimatedTokens: number;
  maxTokens: number;
}

export function checkTokenBudget(
  text: string,
  maxTokens: number = getMaxAiInputTokens(),
): TokenBudgetCheck {
  const estimatedTokens = estimateTokens(text);
  return {
    withinBudget: estimatedTokens <= maxTokens,
    estimatedTokens,
    maxTokens,
  };
}

/**
 * Standard warning shown when a payload is skipped to avoid an over-limit
 * Gemini call. `step` is the name of the AI step being skipped.
 */
export function overBudgetWarning(step: string, check: TokenBudgetCheck): string {
  const est = Math.round(check.estimatedTokens / 1000);
  const max = Math.round(check.maxTokens / 1000);
  return (
    `[token-guard] Payload ~${est}k tokenů přesahuje limit ${max}k — ${step} přeskočen, použit raw vstup. ` +
    `Zacil URL na jednu konkrétní variantu, zapni --collapse-variants, nebo zvyš MAX_AI_INPUT_TOKENS.`
  );
}
