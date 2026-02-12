import * as t from "@babel/types";
import _traverse, { NodePath } from "@babel/traverse";
import _generate from "@babel/generator";
import * as parser from "@babel/parser";

// @ts-ignore - Babel packages have type issues with default exports
const traverse = (_traverse as any).default || _traverse;
// @ts-ignore
const generate = (_generate as any).default || _generate;
// @ts-ignore
const parse = (parser as any).parse;

/**
 * Compute a simple fingerprint for a JSX element node
 * Used for detecting duplicate components
 */
function computeTreeFingerprint(node: t.JSXElement, options: any = {}): string {
    const openingElement = node.openingElement;

    // Get tag name
    let tagName = "";
    if (t.isJSXIdentifier(openingElement.name)) {
        tagName = openingElement.name.name;
    } else if (t.isJSXMemberExpression(openingElement.name)) {
        tagName = generate(openingElement.name).code;
    }

    // Count children
    const childrenCount = node.children.length;

    // Count props
    const propsCount = openingElement.attributes.length;

    // Get class names (if any)
    let classNames = "";
    for (const attr of openingElement.attributes) {
        if (t.isJSXAttribute(attr) && attr.name.name === "className") {
            if (t.isStringLiteral(attr.value)) {
                classNames = attr.value.value;
            } else if (t.isJSXExpressionContainer(attr.value)) {
                classNames = generate(attr.value).code;
            }
        }
    }

    // Create fingerprint from tag, props count, children count, and classes
    return `${tagName}:${propsCount}:${childrenCount}:${classNames}`;
}

/**
 * A group of JSX elements that are identical candidates for extraction
 */
export interface ComponentCandidate {
  /** The unique fingerprint for this component */
  fingerprint: string;
  /** All occurrences of this component */
  occurrences: t.JSXElement[];
  /** A representative example (first occurrence) */
  example: t.JSXElement;
  /** Count of occurrences */
  count: number;
  /** Suggested component name */
  suggestedName: string;
}

/**
 * Options for component extraction
 */
export interface ExtractorOptions {
  /** Minimum number of repeats to consider extraction */
  minRepeats?: number;
  /** Fingerprinting options */
  fingerprintOptions?: Partial<FingerprintOptions>;
  /** Base name for generated components */
  componentNameBase?: string;
  /** Set of tag names to skip (e.g., SVG elements) */
  skipTags?: Set<string>;
}

/**
 * Default extraction options
 */
const DEFAULT_OPTIONS: Required<ExtractorOptions> = {
  minRepeats: 2,
  fingerprintOptions: {},
  componentNameBase: "Extracted",
  skipTags: new Set([
    "svg", "clippath", "defs", "ellipse", "g", "lineargradient", "mask",
    "path", "pattern", "polygon", "polyline", "radialgradient", "rect", "stop",
    "circle", "image", "line", "text", "tspan", "use", "foreignobject"
  ]),
};

/**
 * Get the tag name from a JSX element
 */
function getTagName(node: t.JSXElement): string | null {
  const name = node.openingElement.name;
  return t.isJSXIdentifier(name) ? name.name : null;
}

/**
 * Check if a tag should be skipped
 */
function shouldSkipTag(node: t.JSXElement, skipTags: Set<string>): boolean {
  const tagName = getTagName(node);
  if (!tagName) return true;
  return skipTags.has(tagName.toLowerCase());
}

/**
 * Check if a node is a custom component (starts with uppercase)
 */
function isCustomComponent(node: t.JSXElement): boolean {
  const tagName = getTagName(node);
  if (!tagName) return false;
  return /^[A-Z]/.test(tagName);
}

/**
 * Find all extractable component candidates in the AST
 */
export function findComponentCandidates(
  ast: t.File | t.Program,
  options: Partial<ExtractorOptions> = {}
): ComponentCandidate[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const candidates = new Map<string, t.JSXElement[]>();
  let componentCounter = 0;

  // Traverse to find all JSX elements
  const program = t.isFile(ast) ? ast.program : ast;

  traverse(program, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const node = path.node;

      // Skip certain tags
      if (shouldSkipTag(node, opts.skipTags)) {
        return;
      }

      // Skip if parent is a skip tag
      const parentPath = path.parentPath;
      if (parentPath && t.isJSXElement(parentPath.node)) {
        if (shouldSkipTag(parentPath.node, opts.skipTags)) {
          return;
        }
      }

      // Skip custom components (already extracted)
      if (isCustomComponent(node)) {
        return;
      }

      // Skip if not in a JSX parent (e.g., already at root)
      if (!parentPath || !t.isJSXElement(parentPath.node)) {
        return;
      }

      // Compute fingerprint
      const fingerprint = computeTreeFingerprint(node, opts.fingerprintOptions);

      // Add to candidates
      if (!candidates.has(fingerprint)) {
        candidates.set(fingerprint, []);
      }
      candidates.get(fingerprint)!.push(node);
    },
  });

  // Filter by minRepeats and create ComponentCandidate objects
  const results: ComponentCandidate[] = [];

  for (const [fingerprint, occurrences] of candidates.entries()) {
    if (occurrences.length < opts.minRepeats) {
      continue;
    }

    const [example] = occurrences;

    // Skip if already wrapped in a parent that's a custom component
    // (avoids creating wrappers around already-extracted components)
    let shouldSkip = false;
    for (const occ of occurrences) {
      const parentPath = findParentPath(occ, program);
      if (parentPath && t.isJSXElement(parentPath.node) && isCustomComponent(parentPath.node)) {
        shouldSkip = true;
        break;
      }
    }

    if (shouldSkip) {
      continue;
    }

    results.push({
      fingerprint,
      occurrences,
      example,
      count: occurrences.length,
      suggestedName: `${opts.componentNameBase}${++componentCounter}`,
    });
  }

  // Sort by count (most repeats first)
  results.sort((a, b) => b.count - a.count);

  return results;
}

/**
 * Find the parent path for a node within the program
 * Uses path parent reference instead of traversing to avoid scope issues
 */
function findParentPath(
  node: t.JSXElement,
  program: t.Program
): NodePath<t.JSXElement> | null {
  let result: NodePath<t.JSXElement> | null = null;

  try {
    traverse(program, {
      JSXElement(path: NodePath<t.JSXElement>) {
        if (path.node === node) {
          // Use parentPath directly instead of re-traversing
          const parentPath = path.parentPath;
          if (parentPath && t.isJSXElement(parentPath.node)) {
            result = parentPath as NodePath<t.JSXElement>;
          }
          // Stop traversal once found
          path.stop();
        }
      },
    });
  } catch (error) {
    // If scope error occurs, return null
    console.warn('Scope error while finding parent path:', error);
    return null;
  }

  return result;
}

/**
 * Extract a component from a candidate and return the declaration
 */
export function extractComponentDeclaration(
  candidate: ComponentCandidate,
  options: Partial<ExtractorOptions> = {}
): t.FunctionDeclaration {
  const { example, suggestedName } = candidate;

  // Create a simple function that returns the JSX
  return t.functionDeclaration(
    t.identifier(suggestedName),
    [],
    t.blockStatement([t.returnStatement(t.cloneNode(example))])
  );
}

/**
 * Replace occurrences with component instances
 */
export function replaceOccurrencesWithComponent(
  ast: t.Program,
  candidate: ComponentCandidate
): void {
  const { occurrences, suggestedName } = candidate;

  try {
    traverse(ast, {
      JSXElement(path: NodePath<t.JSXElement>) {
        if (occurrences.includes(path.node)) {
          // Replace with self-closing component reference
          const replacement = t.jsxElement(
            t.jsxOpeningElement(t.jsxIdentifier(suggestedName), [], true),
            null,
            [],
            true
          );
          path.replaceWith(replacement);
          // Stop traversal after replacement to avoid scope issues
          path.stop();
        }
      },
    });
  } catch (error) {
    console.warn('Error replacing component occurrences:', error);
  }
}

/**
 * Extract components and return the modified code with component declarations
 */
export interface ExtractionResult {
  /** The modified code */
  code: string;
  /** List of extracted components */
  components: Array<{
    name: string;
    count: number;
    fingerprint: string;
  }>;
  /** Whether any changes were made */
  changed: boolean;
}

/**
 * Extract all duplicate components from the code
 */
export function extractComponents(
  code: string,
  options: Partial<ExtractorOptions> = {}
): ExtractionResult {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  const candidates = findComponentCandidates(ast, options);

  if (candidates.length === 0) {
    return { code, components: [], changed: false };
  }

  const program = ast.program;

  // Process candidates from most repeats to least
  const extractedComponents: Array<{
    name: string;
    count: number;
    fingerprint: string;
  }> = [];

  for (const candidate of candidates) {
    // Create component declaration
    const decl = extractComponentDeclaration(candidate, options);

    // Add to program body
    program.body.unshift(decl);

    // Replace occurrences
    replaceOccurrencesWithComponent(program, candidate);

    extractedComponents.push({
      name: candidate.suggestedName,
      count: candidate.count,
      fingerprint: candidate.fingerprint,
    });
  }

  // Generate output
  const output = generate(ast, { jsescOption: { minimal: true } });

  return {
    code: output.code,
    components: extractedComponents,
    changed: true,
  };
}
