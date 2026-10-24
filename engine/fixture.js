import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export async function listFixtures() {
  const files = await fs.readdir(DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

export async function loadFixture(id) {
  // id lands here from a query param, so keep it inside DIR.
  const safe = path.basename(id, '.json');
  const raw = await fs.readFile(path.join(DIR, `${safe}.json`), 'utf8');
  return JSON.parse(raw);
}

/**
 * Stoppage time is where this match is decided — three of the five contested
 * moments live in it. Collapsing them onto minute 90 loses their order, so
 * 90+2 counts as 92 on a single linear clock. `clock` stays the display label.
 */
export function effTime(e) {
  return e.minute + (e.stoppage || 0);
}

/** Everything that has happened at or before `minute`, oldest first. */
export function eventsUpTo(fixture, minute) {
  return fixture.events.filter((e) => effTime(e) <= minute);
}

/** The most recent contested moment — what "why was that not a penalty" almost always means. */
export function nearestContested(fixture, minute) {
  const past = fixture.events.filter((e) => e.contested && effTime(e) <= minute);
  return past.length ? past[past.length - 1] : null;
}
