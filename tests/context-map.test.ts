/**
 * The Context Map "Details" headline must use the SAME cache-weighted tokens
 * as the recent row's As-text / Sent / Saved columns. The old headline divided
 * the RAW count_tokens baseline by RAW sent tokens (cache-blind), so it could
 * trumpet "74% smaller" on a request the cache-aware row marked a net loss —
 * the exact contradiction that made the number untrustworthy. These tests pin
 * the two panels together.
 */
import { describe, it, expect } from 'vitest';
import { renderContextMapFragment, type ContextMapData } from '../src/dashboard/fragments.js';

function ctx(p: Partial<ContextMapData> = {}): ContextMapData {
  return {
    id: 1,
    baselineTokens: 0,
    realInput: 0,
    baselineInputEff: 0,
    actualInputEff: 0,
    haveBaseline: true,
    output: 0,
    imageCount: 1,
    buckets: { static_slab: 1000 },
    imageIds: [1],
    compressed: true,
    ...p,
  };
}

describe('renderContextMapFragment — cache-aware headline', () => {
  it('says "smaller" only when the cache-weighted baseline actually beats what was sent', () => {
    const html = renderContextMapFragment(ctx({ baselineInputEff: 2000, actualInputEff: 400 }), []);
    expect(html).toContain('<span class="ctx-big">80%</span> smaller');
    expect(html).not.toContain('bigger');
  });

  it('says "bigger" — not "smaller" — when imaging cost more than the cached text would have (the trust bug)', () => {
    // The user's real shape: cache-weighted text baseline (~1,500) < image sent
    // (~1,800). The RAW count_tokens (~7,500) is what made the old headline lie
    // "76% smaller" while the row's Saved column showed a loss.
    const html = renderContextMapFragment(
      ctx({ baselineInputEff: 1500, actualInputEff: 1800, baselineTokens: 7500, realInput: 1800 }),
      [],
    );
    expect(html).toContain('<span class="ctx-big">20%</span> bigger');
    // Must NOT resurrect the cache-blind "smaller" claim in the headline.
    expect(html).not.toContain('class="ctx-big">76%</span> smaller');
    // The sub-line still surfaces the raw shrink AND explains why it cost more.
    expect(html).toContain('76% smaller');
    expect(html).toContain('cache-read');
  });

  it('headline direction always agrees with the row Saved column (baselineInputEff − actualInputEff)', () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [2000, 400], // saving → smaller
      [1500, 1800], // loss → bigger
    ];
    for (const [b, a] of cases) {
      const html = renderContextMapFragment(ctx({ baselineInputEff: b, actualInputEff: a }), []);
      if (b - a > 0) {
        expect(html).toMatch(/ctx-big">\d+%<\/span> smaller/);
      } else {
        expect(html).toContain('bigger');
      }
    }
  });

  it('makes no savings claim when the baseline probe did not resolve', () => {
    const html = renderContextMapFragment(
      ctx({ haveBaseline: false, baselineInputEff: 0, actualInputEff: 1800, baselineTokens: 7500, realInput: 1800 }),
      [],
    );
    expect(html).toContain('billed tokens sent');
    expect(html).not.toContain('% smaller');
    expect(html).not.toContain('% bigger');
    expect(html).toContain('no trustworthy text baseline');
  });
});
