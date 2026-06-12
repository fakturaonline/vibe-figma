import { importFigma, fetchFigmaImages } from './figma-client.js';
import { FigmaToHTML } from './figma-to-html.js';
import { transformJsx } from './transform-jsx.js';
import { cleanupGeneratedCodeToReadable } from '../cleaner/index.js';
import { extractComponents } from './componentization/index.js';
import { mapToFrameworkWithAI } from '../mapping/framework-mapper-ai.js';
import { collapseComponentSet, type VariantContext } from './variant-collapse.js';
import { extractPalette, snapColorsToPalette } from './color-fidelity.js';
import { readFile } from 'fs/promises';
import type {
    FigmaToReactOptions,
    FigmaToReactResult,
    ImportOptions
} from './types.js';

export class FigmaToReact {
    private accessToken: string;
    private authType: 'x-figma-token' | 'authorization';
    private options: FigmaToReactOptions;

    constructor(
        accessToken: string,
        authType: 'x-figma-token' | 'authorization' = 'x-figma-token',
        options: FigmaToReactOptions = {}
    ) {
        this.accessToken = accessToken;
        this.authType = authType;
        this.options = options;
    }

    async convertFromUrl(figmaUrl: string): Promise<FigmaToReactResult | null> {
        try {
            const importOptions: ImportOptions = {
                geometry: 'paths',
                ...this.options
            };

            console.log('Importing Figma file...');
            const figmaData = await importFigma({
                url: figmaUrl,
                options: importOptions,
                accessToken: this.accessToken,
                authType: this.authType
            });

            if (!figmaData) {
                throw new Error('Failed to import Figma file');
            }

            const documentNode = figmaData.endpoint === 'nodes'
                ? Object.values(figmaData.nodes || {})[0]?.document
                : figmaData.document;

            if (!documentNode) {
                throw new Error('No document found in Figma data');
            }

            // Collapse a component set (many variants) down to a small,
            // color-covering SAMPLE of variants + its variant axes, so we don't
            // render (and send to the LLM) dozens of near-identical subtrees.
            let nodeToConvert = documentNode;
            let variantContext: VariantContext | undefined;
            let variantSamples: Array<{ node: any; label: string }> | undefined;

            if (this.options.collapseVariants) {
                const collapse = collapseComponentSet(documentNode, {
                    maxSamples: this.options.variantSamples,
                });
                if (collapse) {
                    const axisCount = Object.keys(collapse.variantAxes).length;
                    console.log(
                        `Detected component set "${collapse.componentName}" — collapsing to ${collapse.samples.length} variant sample(s) ` +
                        `(${axisCount} variant axes: ${Object.entries(collapse.variantAxes)
                            .map(([k, v]) => `${k}[${v.length}]`)
                            .join(', ')})`
                    );

                    variantSamples = collapse.samples.map((s, i) => ({
                        // Unique wrapper name per sample; the real variant props
                        // are carried in the label comment for the AI.
                        node: { ...s.node, name: `${collapse.componentName}Sample${i + 1}` },
                        label: s.variantName,
                    }));
                    nodeToConvert = variantSamples[0].node;

                    let spec: string | undefined;
                    if (this.options.specPath) {
                        try {
                            spec = await readFile(this.options.specPath, 'utf-8');
                        } catch (error) {
                            console.warn(`Could not read spec from ${this.options.specPath}:`, error);
                        }
                    }

                    variantContext = {
                        componentName: collapse.componentName,
                        variantAxes: collapse.variantAxes,
                        spec,
                    };
                } else {
                    console.log('collapseVariants enabled but no component set found — converting full tree.');
                }
            }

            console.log('Pre-processing to extract image nodes...');

            // First pass: create converter to extract image references
            const preConverter = new FigmaToHTML(this.options);
            const prepassNodes = variantSamples ? variantSamples.map((s) => s.node) : [nodeToConvert];
            for (const node of prepassNodes) {
                preConverter.convertNode(node);
            }

            let imageUrlToFilename: Map<string, string> = new Map();
            let assets: Record<string, string> = {};

            // Use the imageNodes Map from the converter
            let imageRefToFilename: Map<string, string> = new Map();

            if (preConverter.imageNodes.size > 0) {
                console.log(`Found ${preConverter.imageNodes.size} images, downloading...`);
                const imageData = await fetchFigmaImages(
                    figmaData.fileKey,
                    preConverter.imageNodes,
                    this.accessToken,
                    this.authType
                );

                if (imageData && imageData.imageMap) {
                    const downloadResult = await this.downloadAndConvertImages(imageData.imageMap);
                    imageUrlToFilename = downloadResult.urlToFilename;
                    imageRefToFilename = downloadResult.imageRefToFilename;
                    assets = downloadResult.assets;
                    console.log(`Downloaded and converted ${Object.keys(assets).length} images`);
                }
            } else {
                console.log('No images found in the design');
            }

            console.log('Converting to JSX...');

            // Create imageUrls mapping using imageRef as keys (for FigmaToHTML)
            const imageUrls: Record<string, string> = {};
            for (const [imageRef, filename] of imageRefToFilename.entries()) {
                imageUrls[imageRef] = `/${filename}`;
            }

            const converterOptions = {
                ...this.options,
                imageUrls,
                // Framework mapping is now done AFTER AI cleanup, not during conversion
                frameworkMapping: undefined
            };

            let jsxResult: { componentName: string; jsx: string; fonts: string; css: string };
            let jsx: string;
            let colorPalette: string[] | undefined;

            if (variantSamples) {
                // Render each sampled variant and concatenate them (each labelled
                // with its variant props) so the AI sees the REAL colors/styles
                // per family/state and produces one parametrized component.
                const blocks: string[] = [];
                let first: typeof jsxResult | undefined;
                for (let i = 0; i < variantSamples.length; i++) {
                    const sampleConverter = new FigmaToHTML(converterOptions);
                    const r = await sampleConverter.convertJSX(variantSamples[i].node);
                    if (i === 0) first = r;
                    blocks.push(`/* Variant sample: ${variantSamples[i].label} */\n${r.jsx}`);
                }
                jsxResult = { ...(first as typeof jsxResult), componentName: variantContext!.componentName };
                jsx = blocks.join('\n\n');
                // Ground-truth color palette from the raw rendered samples, used
                // after AI cleanup to repair any color drift introduced by the LLM.
                colorPalette = extractPalette(jsx);
            } else {
                const converter = new FigmaToHTML(converterOptions);
                jsxResult = await converter.convertJSX(nodeToConvert);
                jsx = jsxResult.jsx as string;
            }

            jsx = this.replaceImageUrls(jsx, imageUrlToFilename);

            if (this.options.optimizeComponents) {
                console.log('Optimizing components...');
                try {
                    const optimized = transformJsx(jsx);
                    jsx = optimized.code;
                } catch (error) {
                    console.warn('Component optimization failed, using unoptimized JSX:', error);
                }
            }

            if (this.options.useCodeCleaner) {
                console.log('Cleaning up generated code...');
                try {
                    jsx = await cleanupGeneratedCodeToReadable(jsx, { variantContext });
                } catch (error) {
                    console.warn('Code cleanup failed, using uncleaned JSX:', error);
                }

                // Repair any color drift the LLM may have introduced by snapping
                // colors back to the design's real palette (collapse path only).
                if (colorPalette && colorPalette.length > 0) {
                    const { code, snapped } = snapColorsToPalette(jsx, colorPalette);
                    if (snapped > 0) {
                        console.log(`Color fidelity: snapped ${snapped} drifted color(s) back to the design palette.`);
                    }
                    jsx = code;
                }
            }

            // Deduplicate similar components AFTER cleanup but BEFORE framework mapping
            // (Babel parser can't handle framework imports with path aliases)
            if (this.options.dedupeComponents) {
                console.log('Detecting and extracting duplicate components...');
                try {
                    const extractionResult = extractComponents(jsx, {
                        minRepeats: 2,
                        componentNameBase: 'Reusable',
                    });

                    if (extractionResult.changed) {
                        console.log(`Extracted ${extractionResult.components.length} reusable components:`);
                        for (const comp of extractionResult.components) {
                            console.log(`  - ${comp.name}: ${comp.count} occurrences`);
                        }
                        jsx = extractionResult.code;
                    } else {
                        console.log('No duplicate components found');
                    }
                } catch (error) {
                    console.warn('Component deduplication failed, using original JSX:', error);
                }
            }

            // Apply framework mapping LAST (after deduplication to avoid Babel parse errors)
            if (this.options.framework && this.options.framework !== 'none') {
                console.log(`Applying ${this.options.framework} framework mapping...`);
                try {
                    jsx = await mapToFrameworkWithAI(jsx, this.options.framework, this.options.tailwindConfigPath);
                } catch (error) {
                    console.warn('Framework mapping failed, using unmapped JSX:', error);
                }
            }

            return {
                jsx,
                assets,
                componentName: jsxResult.componentName,
                fonts: jsxResult.fonts,
                css: jsxResult.css,
            };

        } catch (error) {
            console.error('Error converting Figma to React:', error);
            return null;
        }
    }


    private async downloadImage(url: string): Promise<Buffer> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            console.error('Error downloading image:', url, error);
            throw error;
        }
    }

    private imageToBase64(buffer: Buffer, mimeType: string = 'image/png'): string {
        const base64 = buffer.toString('base64');
        return `data:${mimeType};base64,${base64}`;
    }

    private getMimeTypeFromUrl(url: string): string {
        const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
        const mimeTypes: Record<string, string> = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml'
        };
        return mimeTypes[extension || 'png'] || 'image/png';
    }

    private async downloadAndConvertImages(imageMap: Record<string, string>): Promise<{
        urlToFilename: Map<string, string>,
        imageRefToFilename: Map<string, string>,
        assets: Record<string, string>
    }> {
        const urlToFilename = new Map<string, string>();
        const imageRefToFilename = new Map<string, string>();
        const assets: Record<string, string> = {};
        const entries = Object.entries(imageMap);

        const downloadPromises = entries.map(async ([imageRef, url], index) => {
            try {
                // Extract extension from URL, default to 'png' if not found or invalid
                let extension = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';

                // Validate extension - must be a valid image extension
                const validExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
                if (!validExtensions.includes(extension)) {
                    extension = 'png'; // Default to png for Figma images
                }

                const filename = `image-${String(index + 1).padStart(3, '0')}.${extension}`;

                const buffer = await this.downloadImage(url);
                const mimeType = this.getMimeTypeFromUrl(url);
                const base64 = this.imageToBase64(buffer, mimeType);

                urlToFilename.set(url, filename);
                imageRefToFilename.set(imageRef, filename);
                assets[filename] = base64;

                return { url, filename, success: true };
            } catch (error) {
                console.error(`Failed to download image ${imageRef}:`, error);
                return { url, filename: '', success: false };
            }
        });

        await Promise.all(downloadPromises);

        return { urlToFilename, imageRefToFilename, assets };
    }

    private replaceImageUrls(jsx: string, imageUrlToFilename: Map<string, string>): string {
        let result = jsx;

        for (const [url, filename] of imageUrlToFilename.entries()) {
            const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            result = result.replace(new RegExp(escapedUrl, 'g'), `/${filename}`);

            result = result.replace(
                new RegExp(`url\\(["']?${escapedUrl}["']?\\)`, 'g'),
                `url("/${filename}")`
            );

            result = result.replace(
                new RegExp(`src=["']${escapedUrl}["']`, 'g'),
                `src="/${filename}"`
            );

            result = result.replace(
                new RegExp(`href=["']${escapedUrl}["']`, 'g'),
                `href="/${filename}"`
            );
        }

        return result;
    }
}

export async function convertFigmaToReact(
    figmaUrl: string,
    accessToken: string,
    authType: 'x-figma-token' | 'authorization' = 'x-figma-token',
    options: FigmaToReactOptions = {}
): Promise<FigmaToReactResult | null> {
    const converter = new FigmaToReact(accessToken, authType, options);
    return converter.convertFromUrl(figmaUrl);
}
