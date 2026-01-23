import { promises as fs } from 'fs'
import path from 'path'
import prompts from 'prompts'
import type { SavedFiles } from '../types.js'

/**
 * Ensure directory exists, create if it doesn't
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Prompt user to confirm file overwrite
 */
async function confirmOverwrite(filePath: string): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'overwrite',
    message: `File ${filePath} already exists. Overwrite?`,
    initial: false,
  })

  return response.overwrite ?? false
}

/**
 * Add fonts to component JSX
 */
function addFontsToComponent(jsx: string, fonts: string): string {
  if (!fonts || fonts.trim() === '') {
    return jsx
  }

  // If fonts contain <link> tags, add as comment at the top
  if (fonts.includes('<link')) {
    return `/*
 * Add this to your HTML head:
 * ${fonts.trim()}
 */

${jsx}`
  }

  // Otherwise add as comment
  return `/* Fonts: ${fonts.trim()} */

${jsx}`
}

/**
 * Save React component to file
 */
export async function saveComponent(
  jsx: string,
  componentPath: string,
  fonts: string
): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(componentPath)
  await ensureDir(dir)

  // Check if file exists
  if (await fileExists(componentPath)) {
    const shouldOverwrite = await confirmOverwrite(componentPath)
    if (!shouldOverwrite) {
      throw new Error(`Skipped: ${componentPath} already exists`)
    }
  }

  // Add fonts to component
  const componentContent = addFontsToComponent(jsx, fonts)

  // Write file
  await fs.writeFile(componentPath, componentContent, 'utf-8')
}

/**
 * Save CSS to file
 */
export async function saveCss(css: string, cssPath: string): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(cssPath)
  await ensureDir(dir)

  // Check if file exists
  if (await fileExists(cssPath)) {
    const shouldOverwrite = await confirmOverwrite(cssPath)
    if (!shouldOverwrite) {
      throw new Error(`Skipped: ${cssPath} already exists`)
    }
  }

  // Write file
  await fs.writeFile(cssPath, css, 'utf-8')
}

/**
 * Decode base64 asset and save to file
 */
async function saveAsset(
  filename: string,
  base64Data: string,
  assetsDir: string
): Promise<string> {
  // Remove 'base64:' prefix if present
  const cleanBase64 = base64Data.replace(/^base64:/, '')

  // Decode base64 to buffer
  const buffer = Buffer.from(cleanBase64, 'base64')

  // Ensure assets directory exists
  await ensureDir(assetsDir)

  // Full path to asset file
  const assetPath = path.join(assetsDir, filename)

  // Check if file exists
  if (await fileExists(assetPath)) {
    const shouldOverwrite = await confirmOverwrite(assetPath)
    if (!shouldOverwrite) {
      return assetPath // Return existing path
    }
  }

  // Write binary file
  await fs.writeFile(assetPath, buffer)

  return assetPath
}

/**
 * Save all assets to directory
 */
export async function saveAssets(
  assets: Record<string, string>,
  assetsDir: string
): Promise<string[]> {
  const savedPaths: string[] = []

  for (const [filename, base64Data] of Object.entries(assets)) {
    try {
      const savedPath = await saveAsset(filename, base64Data, assetsDir)
      savedPaths.push(savedPath)
    } catch (error) {
      console.error(`Failed to save asset ${filename}:`, error)
      // Continue with other assets
    }
  }

  return savedPaths
}

/**
 * Save all conversion results to files
 */
export async function saveConversionResults(
  result: {
    jsx: string
    assets: Record<string, string>
    css: string
    fonts: string
  },
  paths: {
    component: string
    css?: string
    assets: string
  }
): Promise<SavedFiles> {
  const savedFiles: SavedFiles = {
    component: '',
    assets: [],
  }

  // Save component
  await saveComponent(result.jsx, paths.component, result.fonts)
  savedFiles.component = paths.component

  // Save CSS if path provided and not using Tailwind
  if (paths.css && result.css && result.css.trim() !== '') {
    await saveCss(result.css, paths.css)
    savedFiles.css = paths.css
  }

  // Save assets
  if (Object.keys(result.assets).length > 0) {
    savedFiles.assets = await saveAssets(result.assets, paths.assets)
  }

  return savedFiles
}
