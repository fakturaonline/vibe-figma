import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import fs from 'fs/promises'
import prompt from "./prompt.txt"


export const cleanupGeneratedCodeToReadable = async (code: string): Promise<string> => {
    try {
        
        if(!process.env.ANTHROPIC_API_KEY) {
            throw new Error("ANTHROPIC_API_KEY is not set")
        }
        const response = await generateText({
            model: anthropic('claude-sonnet-4-6'),
            maxOutputTokens: 16000,
            system: prompt,
            prompt: `Here is the code to clean:\n\n<vibe-code>\n${code}\n</vibe-code>`
        })

        const codeMatch = response.text.match(/<vibe-code>([\s\S]*?)<\/vibe-code>/);

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