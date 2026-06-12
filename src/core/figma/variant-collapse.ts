/**
 * Variant collapse
 *
 * A Figma COMPONENT_SET (e.g. a Button with 6 families × 5 sizes × 6 states ≈
 * 180 variants) renders into ~180 near-identical JSX subtrees if converted
 * naively. That payload blows past the LLM token limit and crashes the
 * conversion.
 *
 * Instead we detect the component set and render only a small, color-covering
 * SAMPLE of variants (plus the variant axes), then let the AI turn them into
 * one parametrized component whose appearance is driven by props.
 *
 * Why a sample and not a single variant: a single variant only exposes one
 * family's colors, so the AI has to guess every other family / hover / active /
 * disabled color. We hold the dimensional axis (Size) fixed — it carries no
 * color — and take the cross-product of the remaining (color-bearing) axes, so
 * the AI sees the real color for every family in every state. Dimensions stay
 * correct because the spec table provides them.
 */

import { generateComponentName } from './utils/component-name.js';

export interface VariantAxes {
  [propName: string]: string[];
}

export interface VariantContext {
  componentName: string;
  variantAxes: VariantAxes;
  /** Optional design-system spec markdown to anchor the prop contract. */
  spec?: string;
}

export interface VariantSample {
  /** The Figma COMPONENT node for this variant. */
  node: any;
  /** The raw variant name, e.g. "Variant=Brand, Size=M, State=Hover". */
  variantName: string;
}

export interface CollapseResult {
  /** Small color-covering set of variants to convert (>= 1). */
  samples: VariantSample[];
  variantAxes: VariantAxes;
  componentName: string;
}

export interface CollapseOptions {
  /** Max number of variant samples to render/send to the AI. Default 48. */
  maxSamples?: number;
}

const DEFAULT_MAX_SAMPLES = 48;

/** Recursively find the first COMPONENT_SET in a node tree. */
function findComponentSet(node: any): any | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'COMPONENT_SET') return node;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const found = findComponentSet(child);
    if (found) return found;
  }
  return null;
}

/**
 * Figma keys variant property definitions by the plain prop name, while
 * non-variant props (BOOLEAN / TEXT / INSTANCE_SWAP) carry a `#id` suffix.
 * Strip the suffix defensively.
 */
function cleanPropName(name: string): string {
  return String(name).split('#')[0].trim();
}

/** Extract variant axes from componentPropertyDefinitions, else from child names. */
function extractVariantAxes(setNode: any, children: any[]): VariantAxes {
  const defs = setNode.componentPropertyDefinitions;
  if (defs && typeof defs === 'object') {
    const axes: VariantAxes = {};
    for (const [key, def] of Object.entries<any>(defs)) {
      if (def && Array.isArray(def.variantOptions) && def.variantOptions.length > 0) {
        axes[cleanPropName(key)] = def.variantOptions.map((v: any) => String(v));
      }
    }
    if (Object.keys(axes).length > 0) return axes;
  }
  return parseAxesFromNames(children);
}

/** Parse axes from variant names like "Variant=Brand, Size=M, State=Default". */
function parseAxesFromNames(children: any[]): VariantAxes {
  const sets: Record<string, Set<string>> = {};
  for (const child of children) {
    const parsed = parseVariantName(child?.name);
    for (const [key, value] of Object.entries(parsed)) {
      (sets[key] ||= new Set()).add(value);
    }
  }
  const axes: VariantAxes = {};
  for (const [key, set] of Object.entries(sets)) {
    axes[key] = Array.from(set);
  }
  return axes;
}

/** Default value per variant axis, from componentPropertyDefinitions. */
function getDefaultValues(setNode: any): Record<string, string> {
  const defs = setNode.componentPropertyDefinitions;
  const defaults: Record<string, string> = {};
  if (defs && typeof defs === 'object') {
    for (const [key, def] of Object.entries<any>(defs)) {
      if (def && Array.isArray(def.variantOptions) && def.defaultValue != null) {
        defaults[cleanPropName(key)] = String(def.defaultValue);
      }
    }
  }
  return defaults;
}

function parseVariantName(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(name || '').split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Heuristic: is this axis purely dimensional (size/scale)? Such axes carry no
 * color, so we hold them fixed to shrink the color matrix.
 */
function isDimensionAxis(name: string, values: string[]): boolean {
  if (/\b(size|scale|density|width|height)\b/i.test(name)) return true;
  const sizeWord = /^(xxs|xs|s|sm|m|md|l|lg|xl|xxl|2xl|3xl|4xl|small|medium|large)$/i;
  const matches = values.filter((v) => sizeWord.test(v) || /^\d+(px|rem)?$/.test(v));
  return values.length > 0 && matches.length / values.length >= 0.6;
}

/** Pick the variant that best represents the set's defaults. */
function pickRepresentative(setNode: any, children: any[]): any {
  const defaults = getDefaultValues(setNode);
  if (Object.keys(defaults).length > 0) {
    const match = children.find((c) => {
      const parsed = parseVariantName(c.name);
      return Object.entries(defaults).every(([k, v]) => parsed[k] === v);
    });
    if (match) return match;
  }
  const stateDefault = children.find((c) =>
    /(^|[,\s])State\s*=\s*Default/i.test(String(c?.name || '')),
  );
  return stateDefault || children[0];
}

/** Canonical key for a full variant prop map, used to match children. */
function variantKey(props: Record<string, string>, axisKeys: string[]): string {
  return axisKeys
    .slice()
    .sort()
    .map((k) => `${k}=${props[k] ?? ''}`)
    .join('|');
}

/** Cartesian product of axis values. */
function cartesian(axes: Array<{ key: string; values: string[] }>): Array<Record<string, string>> {
  let acc: Array<Record<string, string>> = [{}];
  for (const { key, values } of axes) {
    const next: Array<Record<string, string>> = [];
    for (const combo of acc) {
      for (const v of values) next.push({ ...combo, [key]: v });
    }
    acc = next;
  }
  return acc;
}

/**
 * Choose a color-covering sample of variants.
 *
 * Strategy: hold dimensional axes (Size) at their default, then take the
 * cross-product of the color-bearing axes (Family × State …). If that exceeds
 * `maxSamples`, fall back to one-at-a-time axis coverage (representative + each
 * axis value swept once).
 */
function generateSamples(
  setNode: any,
  children: any[],
  axes: VariantAxes,
  maxSamples: number,
): VariantSample[] {
  const axisKeys = Object.keys(axes);
  const defaults = getDefaultValues(setNode);

  // No variant axes => there is nothing to sweep, and every child would share
  // the same (empty) lookup key, so the keyed map below would silently keep
  // only the last child. Return the chosen representative explicitly instead.
  if (axisKeys.length === 0) {
    const rep = pickRepresentative(setNode, children);
    return [{ node: rep, variantName: rep.name }];
  }

  // Index children by their full variant key for O(1) lookup.
  const childByKey = new Map<string, any>();
  for (const child of children) {
    const props = parseVariantName(child.name);
    childByKey.set(variantKey(props, axisKeys), child);
  }

  const representative = pickRepresentative(setNode, children);
  const repProps = parseVariantName(representative.name);

  const fixedValue = (axisKey: string): string =>
    defaults[axisKey] ?? repProps[axisKey] ?? axes[axisKey][0];

  const colorAxes = axisKeys.filter((k) => !isDimensionAxis(k, axes[k]));
  const dimAxes = axisKeys.filter((k) => isDimensionAxis(k, axes[k]));

  // Candidate prop maps to sample.
  let combos: Array<Record<string, string>>;

  const matrixSize = colorAxes.reduce((n, k) => n * axes[k].length, 1);

  if (colorAxes.length > 0 && matrixSize <= maxSamples) {
    // Full color matrix at the default dimension(s).
    const base: Record<string, string> = {};
    for (const k of dimAxes) base[k] = fixedValue(k);
    combos = cartesian(colorAxes.map((k) => ({ key: k, values: axes[k] }))).map((c) => ({
      ...base,
      ...c,
    }));
  } else {
    // Fallback: representative + sweep each axis value once.
    combos = [{ ...repProps }];
    for (const k of axisKeys) {
      for (const v of axes[k]) {
        combos.push({ ...repProps, [k]: v });
      }
    }
  }

  // Resolve to children, keeping the representative first, dedup, cap.
  const seen = new Set<string>();
  const ordered: Array<Record<string, string>> = [repProps, ...combos];
  const samples: VariantSample[] = [];

  for (const props of ordered) {
    const key = variantKey(props, axisKeys);
    if (seen.has(key)) continue;
    const child = childByKey.get(key);
    if (!child) continue;
    seen.add(key);
    samples.push({ node: child, variantName: child.name });
    if (samples.length >= maxSamples) break;
  }

  return samples.length > 0
    ? samples
    : [{ node: representative, variantName: representative.name }];
}

/**
 * Detect a component set and collapse it to a small color-covering sample of
 * variants + its variant axes. Returns null when the node is not (and does not
 * contain) a component set, so the caller falls back to full-tree conversion.
 */
export function collapseComponentSet(
  documentNode: any,
  options: CollapseOptions = {},
): CollapseResult | null {
  const setNode = findComponentSet(documentNode);
  if (!setNode) return null;

  const children = (Array.isArray(setNode.children) ? setNode.children : []).filter(
    (c: any) => c && c.type === 'COMPONENT',
  );
  if (children.length === 0) return null;

  const variantAxes = extractVariantAxes(setNode, children);
  const componentName = generateComponentName(setNode.name || 'Component');
  const maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);

  const samples = generateSamples(setNode, children, variantAxes, maxSamples);

  return { samples, variantAxes, componentName };
}
