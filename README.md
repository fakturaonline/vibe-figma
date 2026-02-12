# VibeFigma - Figma to React Converter

[![npm](https://img.shields.io/npm/v/vibefigma)](https://www.npmjs.com/package/vibefigma)
[![stars](https://img.shields.io/github/stars/vibeflowing-inc/vibefigma)](https://github.com/vibeflowing-inc/vibefigma)
[![license](https://img.shields.io/github/license/vibeflowing-inc/vibefigma)](LICENSE)

Transform your Figma designs into production-ready React components with Tailwind CSS, shadcn/ui, and your custom design system.

<div align="center">
  <img src=".github/cli-demo.png" alt="VibeFigma CLI" style="width:100%;max-width:800px;">
</div>

## Features

- **React Component Generation** - Convert Figma frames to React/TypeScript components
- **Tailwind CSS Support** - Automatic Tailwind class generation with your custom config
- **AI Code Cleanup** - Optional AI-powered code cleanup for production-ready output
- **Component Deduplication** - Detect and extract reusable components automatically
- **UI Framework Mapping** - Map designs to shadcn/ui, MUI, or Chakra components
- **Custom Design System Support** - Use your existing Tailwind config for perfect consistency

## Quick Start

### Interactive Mode (Easiest)

```bash
npx vibefigma --interactive
```

### Direct Command

```bash
npx vibefigma "https://www.figma.com/design/..." --token YOUR_TOKEN
```

## New Features

### 1. Component Deduplication

Automatically detect and extract duplicate components:

```bash
npx vibefigma [url] --dedupe-components
```

Features:
- Tree-based similarity detection
- Automatic component extraction with typed props
- Reduces code duplication

### 2. UI Framework Mapping

Map your Figma designs to popular UI frameworks:

```bash
npx vibefigma [url] --framework shadcn --tailwind-config ./tailwind.config.js
```

Supported frameworks:
- `shadcn` - shadcn/ui components (recommended)
- `mui` - Material-UI components
- `chakra` - Chakra UI components
- `none` - Plain HTML/CSS (default)

**Custom Design System Integration:**

When you provide your `tailwind.config.js`, the AI mapper will:
- Replace hex colors with your custom color classes (e.g., `bg-brand-primary`, `text-text-primary`)
- Use your custom spacing scale (e.g., `spacing-300`, `gap-400`)
- Apply your custom border radius (`rounded-100`, `rounded-200`)
- Use your custom font sizes (`body-sm`, `heading-lg`)

### 3. AI Code Cleanup

Clean up generated code with AI:

```bash
npx vibefigma [url] --clean
```

Requires `GOOGLE_GENERATIVE_AI_API_KEY` environment variable.

## Complete Workflow

The conversion pipeline runs in this order:

1. **Figma → JSX** - Convert design to React JSX
2. **Optimize** (optional) - Run Babel transformations
3. **AI Clean** (optional) - Clean up code quality
4. **Component Deduplication** (optional) - Extract reusable components
5. **Framework Mapping** (optional) - Map to shadcn/ui with your design system
6. **Color Mapping** - Apply your custom Tailwind colors

### Full Example

```bash
export GOOGLE_GENERATIVE_AI_API_KEY=your_key

npx vibefigma \
  "https://www.figma.com/design/..." \
  --token $FIGMA_TOKEN \
  --framework shadcn \
  --tailwind-config ./tailwind.config.js \
  --dedupe-components \
  --clean \
  --force
```

## Command Options

```
Usage: vibefigma [options] [url]

Arguments:
  url                           Figma file/node URL

Options:
  -V, --version                 Output the version number
  -t, --token <token>           Figma access token (overrides FIGMA_TOKEN env var)
  -u, --url <url>               Figma file/node URL
  -c, --component <path>        Component output path (default: ./src/components/[ComponentName].tsx)
  -a, --assets <dir>            Assets directory (default: ./public)
  --no-tailwind                 Disable Tailwind CSS (enabled by default)
  --optimize                    Optimize components using Babel transformations
  --clean                       Use AI code cleaner (requires GOOGLE_GENERATIVE_AI_API_KEY)
  --no-classes                  Don't generate CSS classes
  --no-absolute                 Don't use absolute positioning
  --no-responsive               Disable responsive design
  --no-fonts                    Don't include fonts
  --dedupe-components           Detect and deduplicate similar components
  --framework <type>            Target UI framework (shadcn|mui|chakra|none)
  --tailwind-config <path>      Path to your tailwind.config.js for design system mapping
  --interactive                 Force interactive mode
  -f, --force                   Overwrite existing files without confirmation
  -h, --help                    Display help for command
```

## Environment Variables

```bash
# Figma API
FIGMA_TOKEN=your_figma_access_token
FIGMA_ACCESS_TOKEN=your_figma_access_token

# Google AI (for code cleanup and framework mapping)
GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_key
```

## Output Examples

### Basic Conversion

```bash
npx vibefigma "https://www.figma.com/design/..."
```

**Before (Figma):**
- Nested frames
- Auto-layout constraints
- Vector networks

**After (React):**
```tsx
const ComponentName = () => {
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Title</h1>
      <p className="text-gray-600">Description</p>
    </div>
  );
};
```

### With Framework Mapping

```bash
npx vibefigma "https://www.figma.com/design/..." \
  --framework shadcn \
  --tailwind-config ./tailwind.config.js \
  --clean
```

**After (shadcn/ui with design system):**
```tsx
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const ComponentName = () => {
  return (
    <Card className="p-600 border-border-primary">
      <CardHeader>
        <CardTitle className="text-text-primary">Title</CardTitle>
      </CardHeader>
      <CardContent className="text-text-secondary">
        Description
      </CardContent>
    </Card>
  );
};
```

## Component Deduplication

The `--dedupe-components` flag detects similar subtrees and extracts them as reusable components.

**Before:**
```tsx
// Same pattern repeated 5 times
<div className="flex items-center gap-3">
  <CheckIcon />
  <p>Feature text</p>
</div>
```

**After:**
```tsx
const FeatureItem = ({ text }: { text: string }) => (
  <div className="flex items-center gap-3">
    <CheckIcon />
    <p>{text}</p>
  </div>
);

// Used 5 times with different props
<FeatureItem text="Feature 1" />
<FeatureItem text="Feature 2" />
// ...
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development mode
bun run dev:cli

# Build CLI
bun run build:cli

# Test CLI
bun run cli -- --help
```

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
