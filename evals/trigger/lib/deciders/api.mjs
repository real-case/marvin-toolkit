// API decider — the portable default. Reconstructs the auto-discovery decision
// with the Anthropic Messages API: the model is given ONLY the skill catalog
// (name + description, exactly what Claude Code preloads) and the user message,
// and must name the single skill it would load first, or none.
//
// This faithfully measures the *decision* the description drives. It is not the
// same as observing real Claude Code auto-discovery end-to-end — for that, use
// the `claude-cli` decider. Requires ANTHROPIC_API_KEY and Node 18+ (global fetch).

const ENDPOINT = "https://api.anthropic.com/v1/messages";

const SYSTEM = `You are simulating the skill auto-discovery step of an AI coding agent.
At startup the agent has loaded ONLY the name and one-line description of each available skill (below).
When the user sends a message, the agent must decide which SINGLE skill, if any, to invoke first to handle it.
Choose the skill whose description best matches the user's intent AND whose stated trigger conditions apply.
If no skill is an appropriate fit, choose none — do not force a match.
Respond with ONLY a JSON object: {"skill": "<skill-name>" | null, "reason": "<short>"}. No prose, no code fence.`;

/**
 * @param {Object} [opts]
 * @param {string} [opts.model]        default claude-sonnet-5
 * @param {number} [opts.temperature]  default 1 (captures stochastic triggering)
 * @param {string} [opts.apiKey]
 * @returns {import("./index.mjs").Decider}
 */
export function createApiDecider(opts = {}) {
  const model = opts.model || process.env.MARVIN_EVAL_MODEL || "claude-sonnet-5";
  const temperature = opts.temperature ?? 1;
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "api decider needs ANTHROPIC_API_KEY (or pass { apiKey }). Use --decider mock for a dry run.",
    );
  }

  return async ({ catalogText, query }) => {
    const body = {
      model,
      max_tokens: 200,
      temperature,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `AVAILABLE SKILLS:\n${catalogText}\n\nUSER MESSAGE:\n${query.text}\n\nWhich skill do you invoke first (or null)?`,
        },
      ],
    };
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const text = (data.content || [])
      .map((b) => b.text || "")
      .join("")
      .trim();
    return parseDecision(text);
  };
}

/** Tolerant parse: accept a bare JSON object, a fenced block, or a `skill: x` line. */
export function parseDecision(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      const skill = obj.skill === null || obj.skill === undefined ? null : String(obj.skill).trim();
      return { skill: skill || null, reason: obj.reason ? String(obj.reason) : "" };
    } catch {
      // fall through
    }
  }
  const line = text.match(/skill["' :]+([a-z0-9-]+)/i);
  if (line) return { skill: line[1], reason: "parsed from line" };
  return { skill: null, reason: `unparseable: ${text.slice(0, 80)}` };
}
