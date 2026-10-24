/**
 * One streaming interface, two backends. Whichever key is in the env wins;
 * ANTHROPIC first if both are set. Swapping providers is this file only.
 */

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const EFFORT = process.env.EFFORT || 'low';

let cached = null;

function detect() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function describeProvider() {
  const p = detect();
  if (!p) return { provider: null, model: null, ready: false };
  return {
    provider: p,
    model: p === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL,
    ready: true,
  };
}

async function client() {
  if (cached) return cached;
  const provider = detect();
  if (!provider) throw new Error('No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env');

  if (provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    cached = { provider, sdk: new Anthropic() };
  } else {
    const { default: OpenAI } = await import('openai');
    cached = { provider, sdk: new OpenAI() };
  }
  return cached;
}

/**
 * @param {object}   p
 * @param {string}   p.persona    Stable instructions. Cached prefix — never interpolate anything per-request.
 * @param {string}   p.laws       The Laws of the Game corpus. Also cached; the whole reason answers can cite.
 * @param {string}   p.question   Match context + the user's question. Volatile, so it lands after the breakpoint.
 * @param {function} p.onThinking Called with reasoning deltas (Anthropic only).
 * @param {function} p.onText     Called with answer deltas.
 */
export async function streamAnswer({ persona, laws, question, onThinking, onText }) {
  const { provider, sdk } = await client();

  if (provider === 'anthropic') {
    const stream = sdk.messages.stream({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: EFFORT },
      system: [
        { type: 'text', text: persona },
        // Breakpoint on the last stable block, so persona+laws cache as one prefix.
        //
        // 1h TTL, not the 5m default: people ask a question every few minutes
        // during a match, not every few seconds. On the 5m default the ~17k-token
        // prefix would expire between most questions and every one would pay a
        // fresh write. The 1h write costs 2x instead of 1.25x, once, and then the
        // whole match reads at 0.1x — roughly 5x cheaper over a real session.
        { type: 'text', text: laws, cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages: [{ role: 'user', content: question }],
    });

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'thinking_delta') onThinking?.(event.delta.thinking);
      else if (event.delta.type === 'text_delta') onText?.(event.delta.text);
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new Error('Model declined to answer.');
    return final.usage;
  }

  const stream = await sdk.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 2000,
    stream: true,
    messages: [
      { role: 'system', content: `${persona}\n\n${laws}` },
      { role: 'user', content: question },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) onText?.(delta);
  }
  return null;
}
