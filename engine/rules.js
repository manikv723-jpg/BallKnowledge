import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rules');

let corpus = null;

/**
 * The whole corpus goes into every prompt rather than retrieving per-question.
 * It's a stable prefix, so it caches at ~0.1x after the first call — cheaper AND
 * more accurate than retrieving 2-3 laws and paying full price on a prefix that
 * changes every time. Retrieval would also let the model miss a law it needed.
 */
export async function lawsCorpus() {
  if (corpus) return corpus;

  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.md')).sort();
  if (!files.length) {
    throw new Error(`No law files in ${DIR} — the rules corpus is what makes answers citable.`);
  }

  const parts = [];
  for (const f of files) {
    parts.push(await fs.readFile(path.join(DIR, f), 'utf8'));
  }

  corpus = [
    'The following is the text of the IFAB Laws of the Game and the VAR protocol.',
    'This is the ONLY source you may cite. If a law is not in here, you do not know it.',
    '',
    parts.join('\n\n---\n\n'),
  ].join('\n');

  return corpus;
}

export async function corpusStats() {
  const c = await lawsCorpus();
  return { chars: c.length, approxTokens: Math.round(c.length / 3.8) };
}
