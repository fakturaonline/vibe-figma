import { spawn } from "child_process"

/**
 * Generate text by invoking the local `claude` CLI (Claude Code) in print mode.
 * The prompt is piped via stdin to avoid argv length limits on large components.
 * Requires the `claude` CLI to be installed and authenticated.
 */
export function generateWithClaude(system: string, prompt: string): Promise<string> {
    const args = ["-p", "--output-format", "text", "--system-prompt", system]
    if (process.env.CLAUDE_MODEL) {
        args.push("--model", process.env.CLAUDE_MODEL)
    }

    return new Promise((resolve, reject) => {
        const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] })

        let stdout = ""
        let stderr = ""
        proc.stdout.on("data", (chunk) => { stdout += chunk })
        proc.stderr.on("data", (chunk) => { stderr += chunk })

        proc.on("error", (err) => {
            reject(new Error(`Failed to run claude CLI (is Claude Code installed?): ${err.message}`))
        })
        proc.on("close", (code) => {
            if (code === 0) {
                resolve(stdout)
            } else {
                reject(new Error(`claude CLI exited with code ${code}: ${stderr.trim()}`))
            }
        })

        proc.stdin.write(prompt)
        proc.stdin.end()
    })
}
