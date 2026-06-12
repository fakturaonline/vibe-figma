import { spawn } from "child_process"

/**
 * Default model when CLAUDE_MODEL is not set. Haiku, deliberately: mechanical
 * code cleanup/mapping does not need a frontier model, and benchmarking showed
 * `sonnet` via `claude -p` stalls on the API for large component payloads and
 * routinely exceeds the timeout (falling back to raw, uncleaned output), while
 * `haiku` completes the same payload in ~90s. Override with CLAUDE_MODEL.
 */
const DEFAULT_MODEL = "haiku"
/** Hard timeout so a hung `claude` process can't block a conversion forever. */
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Generate text by invoking the local `claude` CLI (Claude Code) in print mode.
 * The prompt is piped via stdin to avoid argv length limits on large components.
 * Requires the `claude` CLI to be installed and authenticated.
 *
 * The invocation is isolated so it behaves like a clean, stateless API call —
 * close to the old Gemini SDK path — rather than a full Claude Code session:
 *   --exclude-dynamic-system-prompt-sections : only OUR system prompt, no env/context sections
 *   --strict-mcp-config --mcp-config {}       : no MCP servers loaded into context
 * This avoids polluting the cleanup/mapping task with local config (CLAUDE.md,
 * MCP tool defs) that the model would otherwise see.
 */
export function generateWithClaude(system: string, prompt: string): Promise<string> {
    const args = [
        "-p",
        "--output-format", "text",
        "--system-prompt", system,
        "--exclude-dynamic-system-prompt-sections",
        "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--model", process.env.CLAUDE_MODEL || DEFAULT_MODEL,
    ]

    const timeoutMs = Number(process.env.CLAUDE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS

    return new Promise((resolve, reject) => {
        const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] })

        let stdout = ""
        let stderr = ""
        let settled = false

        const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            fn()
        }

        const timer = setTimeout(() => {
            finish(() => {
                proc.kill("SIGKILL")
                reject(new Error(`claude CLI timed out after ${timeoutMs}ms`))
            })
        }, timeoutMs)

        proc.stdout.on("data", (chunk) => { stdout += chunk })
        proc.stderr.on("data", (chunk) => { stderr += chunk })

        proc.on("error", (err) => {
            finish(() => reject(new Error(`Failed to run claude CLI (is Claude Code installed?): ${err.message}`)))
        })
        proc.on("close", (code) => {
            finish(() => {
                if (code === 0) {
                    resolve(stdout)
                } else {
                    reject(new Error(`claude CLI exited with code ${code}: ${stderr.trim()}`))
                }
            })
        })

        // Ignore EPIPE if the process exits before we finish writing the prompt.
        proc.stdin.on("error", () => {})
        proc.stdin.write(prompt)
        proc.stdin.end()
    })
}
