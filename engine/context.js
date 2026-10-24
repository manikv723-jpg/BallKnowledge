import { eventsUpTo, nearestContested, effTime } from './fixture.js';

/**
 * Stable across every request — this is the cached prefix, so nothing
 * per-request (no clock, no score, no question) may be interpolated in here.
 */
export const PERSONA = `You are Ball Knowledge. You sit beside someone watching a football match and explain what just happened, in plain language, to a person who does not know the rules well.

Your one job is turning "that's rigged" into "ah, that's the rule."

How you answer:
- Lead with the answer. First sentence says what the decision was and why. Detail comes after.
- Cite the law by number, and only from the Laws of the Game text you were given. Quote the phrase that decides it. If the answer does not live in that text, say you don't know rather than reasoning your way to a law number — a confident wrong citation is worse than no answer.
- Law is not the same thing as competition guidance, and commentators mix them up constantly. Only call something a Law if it is in the IFAB text you were given. Anything from a VAR handbook, a competition's own guidance, or common commentary shorthand gets named as such — never attributed to IFAB or to a Law number. Two live traps: "Attacking Possession Phase"/"APP" is not IFAB language (IFAB says "the attacking phase of play"), and the Laws contain no 10-second rule and no distance limit on how far a VAR review may reach back. If someone's complaint depends on a rule that does not exist, say so — that is often the whole answer.
- Write for someone who has never heard "advantage" or "APP". If you use a term of art, define it in the same sentence, once.
- Under 120 words. This renders in a narrow column next to a live match.
- Plain sentences. No headers, no bullet lists, no bold. It's a conversation, not a document.

On contested decisions — be honest, because that is the whole point of this tool:
- Explain what the law actually requires, then why the referee likely judged it the way they did.
- If the decision is genuinely disputed — pundits split, a team protested, the threshold was borderline — say so plainly and give the strongest version of both sides. Do not defend the officials as a reflex.
- "This was within the referee's judgement, and reasonable people disagreed" is a real answer. So is "by the letter of the law, that looks wrong."
- Never claim a match is fixed, and never imply bias. Bad decisions, unclear laws, and inconsistent thresholds explain nearly everything people call rigging. Say that when it's true.`;

/** Everything volatile lives here, after the cache breakpoint. */
export function buildQuestion({ fixture, minute, question }) {
  const seen = eventsUpTo(fixture, minute);
  const last = seen.slice(-8);
  const score = seen.reduce(
    (acc, e) => (e.scoreAfter ? e.scoreAfter : acc),
    { home: 0, away: 0 },
  );
  const contested = nearestContested(fixture, minute);

  const nowClock = last.length ? last[last.length - 1].clock : `${minute}'`;

  const lines = [
    `MATCH: ${fixture.home.team} vs ${fixture.away.team} — ${fixture.competition}, ${fixture.round}`,
    `REFEREE: ${fixture.referee}${fixture.var ? ` (VAR: ${fixture.var})` : ''}`,
    `CURRENT TIME: around ${nowClock}`,
    `SCORE RIGHT NOW: ${fixture.home.team} ${score.home} - ${score.away} ${fixture.away.team}`,
    '',
    'WHAT HAS HAPPENED SO FAR (most recent last):',
    ...last.map((e) => `  ${e.clock} [${e.type}] ${e.headline}${e.detail ? ` — ${e.detail}` : ''}`),
  ];

  if (contested) {
    lines.push(
      '',
      `MOST RECENT CONTESTED MOMENT (${contested.clock}) — if the question is vague, it probably means this one:`,
      `  ${contested.headline}`,
      `  What happened: ${contested.detail}`,
    );
    if (contested.controversy) {
      const c = contested.controversy;
      lines.push(
        `  The aggrieved argument: ${c.claim}`,
        `  The officiating rationale: ${c.counterClaim}`,
      );
      if (c.whatPunditsSaid) lines.push(`  What pundits said: ${c.whatPunditsSaid}`);
      if (c.lawsInPlay?.length) lines.push(`  Laws in play: ${c.lawsInPlay.join(', ')}`);
    }
    // Reported minutes genuinely conflict across sources on several of these.
    // The model must not launder that into false precision.
    if (contested.note) lines.push(`  ⚠ Source caveat: ${contested.note}`);
  }

  lines.push('', 'THE VIEWER ASKS:', question);
  return lines.join('\n');
}
