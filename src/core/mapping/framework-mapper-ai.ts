import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Read and parse tailwind.config.js file
 */
export function readTailwindConfig(configPath: string): string | null {
    try {
        const resolvedPath = resolve(configPath);
        const content = readFileSync(resolvedPath, 'utf-8');
        return content;
    } catch (error) {
        console.warn(`Could not read tailwind config from ${configPath}:`, error);
        return null;
    }
}

const SHADCN_FRAMEWORK_MAPPING_PROMPT = (tailwindConfig: string | null) => `You are an expert at converting cleaned React components to use shadcn/ui components.

Your task is to analyze the provided React code and convert native HTML elements and custom components to their shadcn/ui equivalents where appropriate.

${tailwindConfig ? `
## CRITICAL: Custom Tailwind Color Mapping

The project uses a CUSTOM Tailwind config with CSS variables for colors. You MUST replace hardcoded hex colors with the project's custom Tailwind color classes.

Here is the project's tailwind.config.js:

\`\`\`javascript
${tailwindConfig}
\`\`\`

### Color Replacement Rules (MANDATORY)

When you see these hex colors or similar colors, REPLACE them with the custom Tailwind classes:

**Backgrounds:**
- \`bg-[#ffffff]\` or \`bg-white\` → \`bg-background-primary\` (primary background)
- Light grays/whites → \`bg-background-secondary\` (secondary background)

**Text:**
- \`text-[#222222]\`, \`text-[#000000]\`, dark colors → \`text-text-primary\` (primary text)
- \`text-[#487285]\`, \`text-[#666666]\`, medium grays → \`text-text-secondary\` (secondary text)
- Disabled colors → \`text-disabled-primary\`

**Brand/Action:**
- \`#[#097fb5]\`, \`#[#097fb1]\`, blues → \`text-brand-primary\` or \`bg-brand-primary\`
- \`#[#fe8f01]\`, \`#[#e58101]\`, oranges → \`text-warning\` or \`bg-warning\`

**Semantic Colors:**
- Reds/pinks → \`text-emotion-danger-dark\` or \`bg-emotion-danger-light\`
- Greens → \`text-emotion-success-dark\` or \`bg-emotion-success-light\`

**Borders:**
- \`border-[#cbe0ed]\`, light blues → \`border-border-primary\`
- \`border-[#e5e7eb]\`, light grays → \`border-border-secondary\`

### Other Custom Classes to Use:
- **Spacing:** \`spacing-100\` through \`spacing-1200\` instead of \`gap-1\`, \`gap-2\`, etc.
- **Border radius:** \`rounded-100\` through \`rounded-800\` instead of \`rounded-sm\`, \`rounded-md\`, etc.
- **Font sizes:** \`body-xs\`, \`body-sm\`, \`body-base\`, \`heading-xs\` through \`heading-3xl\`
- **Fonts:** \`font-poppins\`, \`font-inter\`

**IMPORTANT:** Your goal is to make the code use the project's design system. Replace hardcoded values with semantic Tailwind classes wherever possible.
` : ''}

## shadcn/ui Component Mappings

### Buttons
Convert \`<button>\` or \`<div className="...button...">\` to \`<Button>\`:
- Primary buttons: \`<Button>\`
- Outline/ghost buttons: \`<Button variant="outline">\` or \`<Button variant="ghost">\`
- Destructive buttons: \`<Button variant="destructive">\`

### Cards
Convert card-like containers to \`<Card>\`, \`<CardHeader>\`, \`<CardTitle>\`, \`<CardDescription>\`, \`<CardContent>\`, \`<CardFooter>\`

### Inputs
Convert \`<input>\` elements to \`<Input>\`
Convert \`<textarea>\` to \`<Textarea>\`

### Labels
Convert \`<label>\` elements to \`<Label>\`

### Badges
Convert small badge-like elements to \`<Badge>\`

### Separators
Convert divider lines to \`<Separator>\`

### Tables
Convert \`<table>\` structures to shadcn \`<Table>\`, \`<TableHeader>\`, \`<TableRow>\`, \`<TableHead>\`, \`<TableBody>\`, \`<TableCell>\`

### Alerts
Convert alert/notification boxes to \`<Alert>\`, \`<AlertTitle>\`, \`<AlertDescription>\`

## Conversion Rules

1. **PRESERVE ALL existing Tailwind classes** - especially custom ones from the project config
2. **Preserve ALL props** - onClick, onChange, etc. must remain
3. **Preserve ALL content** - text, icons, nested elements
4. **Add necessary imports** at the top of the file
5. **Keep component logic intact** - don't break functionality
6. **DO NOT replace custom Tailwind classes with default ones**

## Import Template

\`\`\`typescript
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
// ... etc
\`\`\`

## What NOT to Convert

- DO NOT convert semantic HTML that doesn't match shadcn patterns (<section>, <header>, <nav>, <main>, <footer>)
- DO NOT convert complex custom components that are already well-structured
- DO NOT convert elements that are just simple wrappers with no shadcn equivalent
- DO NOT convert SVG icons - keep them as-is

## Output Format

Return ONLY the converted code wrapped in \`<vibe-code></vibe-code>\` tags.

## Example

**Before:**
\`\`\`tsx
<button className="bg-[#097fb5] text-white px-4 py-2 rounded-500">Click me</button>
<div className="border border-[#cbe0ed] rounded-600 p-4 bg-white">
  <h2 className="text-[#222222]">Card Title</h2>
  <p className="text-[#487285]">Card description</p>
</div>
\`\`\`

**After:**
\`\`\`tsx
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

<Button className="bg-brand-primary text-white">Click me</Button>
<Card>
  <CardHeader>
    <CardTitle className="text-text-primary">Card Title</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-text-secondary">Card description</p>
  </CardContent>
</Card>
\`\`\`

## Key Transformations to Apply:

1. **Background colors:** \`bg-[#hex]\` → custom Tailwind colors
2. **Text colors:** \`text-[#hex]\` → custom Tailwind text colors
3. **Border colors:** \`border-[#hex]\` → custom Tailwind border colors
4. **Spacing:** Default \`gap-X\`, \`p-X\`, \`m-X\` → custom \`spacing-X\`
5. **Border radius:** Default \`rounded-X\` → custom \`rounded-X\`
6. **Font sizes:** Default \`text-X\` → custom \`body-X\` or \`heading-X\`

Now convert the following code:`;

/**
 * Map React code to use shadcn/ui components using AI
 */
export async function mapToShadcnWithAI(code: string, tailwindConfigPath?: string): Promise<string> {
    try {
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            console.warn('GOOGLE_GENERATIVE_AI_API_KEY not set, skipping shadcn mapping');
            return code;
        }

        // Read tailwind config if provided
        const tailwindConfig = tailwindConfigPath ? readTailwindConfig(tailwindConfigPath) : null;
        if (tailwindConfigPath && tailwindConfig) {
            console.log(`Using tailwind config from: ${tailwindConfigPath}`);
        }

        console.log('Applying shadcn/ui framework mapping with AI...');

        const response = await generateText({
            model: google('gemini-3-flash-preview'),
            system: SHADCN_FRAMEWORK_MAPPING_PROMPT(tailwindConfig),
            prompt: `Here is the code to map to shadcn/ui:\n\n<vibe-code>\n${code}\n</vibe-code>`
        });

        const codeMatch = response.text.match(/<vibe-code>([\s\S]*?)<\/vibe-code>/);

        if (!codeMatch || !codeMatch[1]) {
            console.warn('AI response did not contain <vibe-code> tags, returning original code');
            return code;
        }

        console.log('✓ shadcn/ui mapping complete');
        return codeMatch[1].trim();
    } catch (error) {
        console.error('Error during shadcn mapping:', error);
        return code;
    }
}

/**
 * Map React code to use MUI components using AI
 */
const MUI_FRAMEWORK_MAPPING_PROMPT = `You are an expert at converting cleaned React components to use Material-UI (MUI) components.

Your task is to analyze the provided React code and convert native HTML elements to their MUI equivalents.

## MUI Component Mappings

### Buttons
Convert \`<button>\` to \`<Button>\`:
- Primary: \`<Button variant="contained">\`
- Outline: \`<Button variant="outlined">\`
- Text: \`<Button variant="text">\`

### Cards
Convert card-like containers to \`<Card>\`, \`<CardContent>\`

### Inputs
Convert \`<input>\` to \`<TextField>\`
Convert \`<textarea>\` to \`<TextField multiline>\`

### Typography
Convert \`<h1>\`-\`<h6>\` to \`<Typography variant="h1">\`-\`<Typography variant="h6">\`
Convert \`<p>\` to \`<Typography variant="body1">\`

... (similar structure as shadcn prompt)

Now convert the following code:`;

export async function mapToMUIWithAI(code: string): Promise<string> {
    try {
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            return code;
        }

        const response = await generateText({
            model: google('gemini-3-flash-preview'),
            system: MUI_FRAMEWORK_MAPPING_PROMPT,
            prompt: `Here is the code to map to MUI:\n\n<vibe-code>\n${code}\n</vibe-code>`
        });

        const codeMatch = response.text.match(/<vibe-code>([\s\S]*?)<\/vibe-code>/);
        return codeMatch?.[1]?.trim() || code;
    } catch (error) {
        console.error('Error during MUI mapping:', error);
        return code;
    }
}

/**
 * Map colors to custom Tailwind classes using AI
 */
const COLOR_MAPPING_PROMPT = (tailwindConfig: string | null) => `You are a color mapping specialist. Your ONLY job is to replace ALL hardcoded colors (hex AND CSS variables) with custom Tailwind color classes.

${tailwindConfig ? `The project uses this tailwind.config.js:

\`\`\`javascript
${tailwindConfig}
\`\`\`

` : ''}

## MANDATORY COLOR REPLACEMENTS

You MUST replace BOTH hex colors AND CSS variables with the corresponding custom Tailwind classes:

### Background Colors (Hex → Tailwind)
- \`bg-[#ffffff]\`, \`bg-white\` → \`bg-background-primary\`
- \`bg-[#f9fafb]\`, \`bg-[#f8fafc]\` → \`bg-background-secondary\`
- \`bg-[#097FB1]\`, \`bg-[#097fb5]\`, \`bg-[#097fb1]\` → \`bg-brand-primary\`
- \`bg-[#FE8F01]\`, \`bg-[#fe8f01]\` → \`bg-warning\`

### Background Colors (CSS Variables → Tailwind)
- \`var(--color-background-primary)\` → \`bg-background-primary\`
- \`var(--color-background-secondary)\` → \`bg-background-secondary\`
- \`var(--color-brand-primary)\` → \`bg-brand-primary\`
- \`var(--color-emotion-success-light)\` → \`bg-emotion-success-light\`
- \`var(--color-emotion-danger-light)\` → \`bg-emotion-danger-light\`

### Text Colors (Hex → Tailwind)
- \`text-[#222222]\`, \`text-[#000000]\`, \`text-black\` → \`text-text-primary\`
- \`text-[#487285]\`, \`text-[#666666]\`, \`text-gray-600\` → \`text-text-secondary\`
- \`text-[#097FB1]\`, \`text-[#097fb5]\` → \`text-brand-primary\`

### Text Colors (CSS Variables → Tailwind)
- \`var(--color-text-primary)\` → \`text-text-primary\`
- \`var(--color-text-secondary)\` → \`text-text-secondary\`
- \`var(--color-text-inverted)\` → \`text-text-inverted\`
- \`var(--color-brand-primary)\` → \`text-brand-primary\`
- \`var(--color-emotion-success-dark)\` → \`text-emotion-success-dark\`
- \`var(--color-emotion-success-light)\` → \`text-emotion-success-light\`
- \`var(--color-emotion-danger-dark)\` → \`text-emotion-danger-dark\`

### Border Colors (Hex → Tailwind)
- \`border-[#CBE0ED]\`, \`border-[#cbe0ed]\` → \`border-border-primary\`
- \`border-[#E5E7EB]\` → \`border-border-secondary\`

### Border Colors (CSS Variables → Tailwind)
- \`var(--color-border-primary)\` → \`border-border-primary\`
- \`var(--color-border-secondary)\` → \`border-border-secondary\`

### For Other Colors
If you see other hex colors, replace them with these rules:
- Red/pink tones → \`text-emotion-danger-dark\` or \`bg-emotion-danger-light\`
- Green tones → \`text-emotion-success-dark\` or \`bg-emotion-success-light\`
- Light grays → \`bg-background-secondary\` or \`text-text-secondary\`

## IMPORTANT
- Replace ALL instances of hardcoded colors
- DO NOT skip any colors
- DO NOT say "preserving visual accuracy" - just do the replacement
- Return the complete code with all colors replaced

Return ONLY the modified code wrapped in <vibe-code> tags.`;

/**
 * Map colors to custom Tailwind classes
 */
export async function mapColorsWithAI(
    code: string,
    tailwindConfigPath?: string
): Promise<string> {
    try {
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            return code;
        }

        const tailwindConfig = tailwindConfigPath ? readTailwindConfig(tailwindConfigPath) : null;

        console.log('Mapping colors to custom Tailwind classes...');

        const response = await generateText({
            model: google('gemini-3-flash-preview'),
            system: COLOR_MAPPING_PROMPT(tailwindConfig),
            prompt: `Here is the code to map colors in:\n\n<vibe-code>\n${code}\n</vibe-code>`
        });

        const codeMatch = response.text.match(/<vibe-code>([\s\S]*?)<\/vibe-code>/);

        if (!codeMatch || !codeMatch[1]) {
            console.warn('AI response did not contain <vibe-code> tags');
            return code;
        }

        console.log('✓ Color mapping complete');
        return codeMatch[1].trim();
    } catch (error) {
        console.error('Error during color mapping:', error);
        return code;
    }
}

/**
 * Main framework mapper function
 */
export async function mapToFrameworkWithAI(
    code: string,
    framework: 'shadcn' | 'mui' | 'chakra' | 'none',
    tailwindConfigPath?: string
): Promise<string> {
    if (framework === 'none') {
        return code;
    }

    let result = code;

    // First, map to framework components
    switch (framework) {
        case 'shadcn':
            result = await mapToShadcnWithAI(code, tailwindConfigPath);
            break;
        case 'mui':
            result = await mapToMUIWithAI(code);
            break;
        case 'chakra':
            console.warn('Chakra UI mapping not yet implemented');
            break;
    }

    // Then, map colors to custom Tailwind classes (if config provided)
    if (tailwindConfigPath && framework !== 'none') {
        result = await mapColorsWithAI(result, tailwindConfigPath);
    }

    return result;
}
