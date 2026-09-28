import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VocabularyCorrector,
  buildSttPrompt,
  extractTerms,
  isIdentifierLike,
  loadVocabulary,
  parseVocabFile,
  rankTerms,
} from '../src/vocab.ts';

describe('vocabulary files', () => {
  it('parses one term per line with comments', () => {
    expect(parseVocabFile('# header\nFoo\n\n  Bar baz  # note\n')).toEqual(['Foo', 'Bar baz']);
  });

  it('loads the manual list before the generated list, de-duplicated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vocab-'));
    try {
      await writeFile(join(dir, 'hotwords.txt'), 'Zeta\nAlpha\n');
      await writeFile(join(dir, 'hotwords.generated.txt'), 'alpha\nBeta\n');
      expect(loadVocabulary(dir)).toEqual(['Zeta', 'Alpha', 'Beta']);
      expect(loadVocabulary(join(dir, 'missing'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe('buildSttPrompt', () => {
  it('builds a capped glossary in priority order', () => {
    expect(buildSttPrompt(['A1', 'B2'])).toBe('Glossary: A1, B2.');
    const prompt = buildSttPrompt(Array.from({ length: 200 }, (_, i) => `Term${i}`), 100)!;
    expect(prompt.length).toBeLessThanOrEqual(101);
    expect(prompt).toContain('Term0');
    expect(buildSttPrompt([])).toBeUndefined();
  });
});

describe('isIdentifierLike', () => {
  it.each([
    ['getUserByID', true],
    ['k8s-prod', true],
    ['deploy.yml', true],
    ['JWT', true],
    ['snake_case', true],
    ['Deployment', false],
    ['billing', false],
  ])('%s -> %s', (term, expected) => {
    expect(isIdentifierLike(term)).toBe(expected);
  });
});

describe('VocabularyCorrector', () => {
  const corrector = new VocabularyCorrector([
    'getUserByID',
    'InvoiceScheduler',
    'StripeWebhookHandler',
    'k8s-staging-eu2',
    'refreshToken',
    'Deployment',
  ]);

  it.each([
    ['call get user by id first', 'call getUserByID first'],
    ['the invoice scheduler runs nightly.', 'the InvoiceScheduler runs nightly.'],
    ['the Stripe web hook handler retries', 'the StripeWebhookHandler retries'],
    ['what about the refresh token?', 'what about the refreshToken?'],
    ['on k8s staging eu2', 'on k8s-staging-eu2'],
    ['the invoice sheduler', 'the InvoiceScheduler'],
  ])('%s -> %s', (input, expected) => {
    expect(corrector.correct(input)).toBe(expected);
  });

  it('leaves ordinary words alone', () => {
    for (const text of ['how does deployment work', 'the user was scheduled', 'refresh the page', 'get it by now']) {
      expect(corrector.correct(text)).toBe(text);
    }
  });

  it('ignores non-identifier terms', () => {
    expect(corrector.size).toBe(5);
  });
});

describe('extractTerms / rankTerms', () => {
  it('finds identifiers, file names, wikilinks and acronyms', () => {
    const terms = extractTerms(
      'The `InvoiceScheduler` in `billing/invoice.go` uses JWT. See [[Auth Service]] and k8s-prod-eu1 via deploy.yml.\n```\nignoredInCode()\n```',
    );
    expect(terms).toEqual(
      expect.arrayContaining(['InvoiceScheduler', 'billing/invoice.go', 'Auth Service', 'JWT', 'k8s-prod-eu1', 'deploy.yml']),
    );
    expect(terms).not.toContain('ignoredInCode');
  });

  it('ranks by frequency and excludes manual terms', () => {
    expect(rankTerms(['b', 'a', 'b', 'c', 'c', 'c', 'x'], 3, ['X'])).toEqual(['c', 'b', 'a']);
  });
});
