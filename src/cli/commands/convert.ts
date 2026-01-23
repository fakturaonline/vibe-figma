import { FigmaToReact } from '../../core/figma/figma-react.js'
import { logger } from '../utils/logger.js'
import { promptForMissingInputs, showConversionSummary, resolveOutputPaths } from '../utils/prompts.js'
import { saveConversionResults } from '../utils/file-writer.js'
import type { CliOptions } from '../types.js'

/**
 * Main conversion command
 */
export async function convertCommand(options: CliOptions): Promise<void> {
  try {
    // Show banner
    logger.showBanner()

    // Check if interactive mode is needed
    const needsInteractive = options.interactive || !options.url || (!options.token && !process.env.FIGMA_TOKEN && !process.env.FIGMA_ACCESS_TOKEN)

    // Prompt for missing inputs
    let finalOptions = options
    if (needsInteractive) {
      finalOptions = await promptForMissingInputs(options)
    } else {
      // Use environment token if not provided
      finalOptions.token = finalOptions.token || process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN
    }

    // Validate required inputs
    if (!finalOptions.url) {
      throw new Error('Figma URL is required. Use --url or --interactive flag.')
    }

    if (!finalOptions.token) {
      throw new Error('Figma access token is required. Set FIGMA_TOKEN environment variable or use --token flag.')
    }

    // Show conversion summary
    showConversionSummary(finalOptions)

    // Start conversion
    logger.startSpinner('Fetching Figma design...')

    // Create converter instance
    const converter = new FigmaToReact(
      finalOptions.token,
      finalOptions.authType || 'x-figma-token',
      {
        useTailwind: finalOptions.useTailwind ?? false,
        optimizeComponents: finalOptions.optimizeComponents ?? false,
        useCodeCleaner: finalOptions.useCodeCleaner ?? false,
        generateClasses: finalOptions.generateClasses ?? true,
        useAbsolutePositioning: finalOptions.useAbsolutePositioning ?? true,
        responsive: finalOptions.responsive ?? true,
        includeFonts: finalOptions.includeFonts ?? true,
      }
    )

    // Convert from URL
    logger.updateSpinner('Converting Figma design to React...')
    const result = await converter.convertFromUrl(finalOptions.url)

    if (!result) {
      throw new Error('Conversion failed. Please check your Figma URL and access token.')
    }

    logger.updateSpinner('Processing results...')

    // Resolve output paths
    const paths = resolveOutputPaths(finalOptions, result.componentName)

    // Save results
    logger.updateSpinner('Saving component...')
    const savedFiles = await saveConversionResults(
      {
        jsx: result.jsx,
        assets: result.assets,
        css: result.css,
        fonts: result.fonts,
      },
      paths
    )

    // Success!
    logger.succeedSpinner('Conversion complete!')

    // Show summary
    logger.showSummary(savedFiles)

  } catch (error) {
    logger.stopSpinner()

    if (error instanceof Error) {
      logger.showError(error)
    } else {
      logger.error('An unexpected error occurred')
      console.error(error)
    }

    process.exit(1)
  }
}
