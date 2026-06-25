/**
 * Verbatim fact-sheet for imaged content.
 *
 * When pxpipe renders a block (system slab, history, tool_result, reminder) to a PNG,
 * the precision-critical, hard-to-OCR strings inside it — file paths, URLs, SHAs/UUIDs,
 * version numbers, CLI flags, large numbers, CONST_IDS — are exactly what a model is
 * most likely to misread off the image yet most likely to need quoted verbatim. This
 * module extracts those tokens so they ride next to the image as plain text: the model
 * quotes them without re-reading the PNG, and they stay in the cached prefix.
 *
 * Deterministic by construction (fixed pattern order, length-desc/lexical sort, no
 * Date/random) → the emitted text is byte-stable across turns and never busts the
 * Anthropic prompt cache. Empirically ~5% of source chars on production history
 * (median 4.9%, max 12.1%, N=10), which preserves the imaging token win.
 */

/** ReDoS-safe extraction patterns (each global). Ordered most- to least-specific so the
 *  longest, most-identifying tokens are kept first when the substring filter runs. */
const PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s)"'<>]+/g, // URLs
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, // UUID
  /(?:[\w@~+-]+)?(?:\/[\w.@+-]+)+\.[A-Za-z]\w{0,8}\b/g, // path with a file extension (multi-dot ok: .test.ts)
  /\/[\w.@+-]+(?:\/[\w.@+-]+)+\/?/g, // dir path (>=2 segments)
  /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g, // git sha / long hex (must contain a digit)
  /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b/g, // version string
  /(?:^|[^\w-])(--?[A-Za-z][\w-]+)/g, // CLI flag (token in capture group 1)
  /\b\d[\d,_]{3,}\b/g, // large / separated number
  /\b\d+\.\d+\b/g, // decimal
  /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/g, // CONST_IDS / env var names
];

const MIN_LEN = 3;
const MAX_LEN = 120;
const MAX_TOKENS = 64; // budget cap per block — longest/most-specific kept first
const MAX_SCAN = 262_144; // defensive input bound; tool_results are already paged
const MAX_CHUNK = 512; // whitespace-free chunks longer than this are blobs (base64, minified) — skip

/**
 * Extract deduped, precision-critical tokens from `text`, longest-first, with any token
 * that is a substring of a longer kept token dropped (so `/github.com` inside the full
 * URL, `lib/x.ts` inside `src/lib/x.ts`, etc. collapse to the most specific form).
 *
 * Every token class is whitespace-free, so we split on whitespace first and skip
 * blob-length chunks. That bounds each regex to a short chunk and keeps extraction
 * strictly O(n) — no quadratic backtracking on delimiter-heavy input like base64 or
 * minified bundles (which embed `/` and would otherwise make the path patterns blow up).
 */
export function extractFactSheetTokens(text: string): string[] {
  const scan = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
  const seen = new Set<string>();
  for (const chunk of scan.split(/\s+/)) {
    if (chunk.length < MIN_LEN || chunk.length > MAX_CHUNK) continue;
    for (const re of PATTERNS) {
      for (const m of chunk.matchAll(re)) {
        // Strip trailing sentence punctuation pulled in from prose (`pull/93.` → `pull/93`);
        // no real identifier we extract ends in these.
        const tok = (m[1] ?? m[0]).trim().replace(/[.,;:!?]+$/, '');
        if (tok.length >= MIN_LEN && tok.length <= MAX_LEN) seen.add(tok);
      }
    }
  }
  // Total order: length desc, then lexical — independent of Set iteration / sort stability.
  const ordered = [...seen].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const kept: string[] = [];
  for (const t of ordered) {
    if (kept.length >= MAX_TOKENS) break;
    if (!kept.some((k) => k.includes(t))) kept.push(t);
  }
  return kept;
}

const OPEN =
  '[Exact identifiers from the rendered context above (paths, ids, versions, numbers) — quote these verbatim instead of transcribing them from the image: ';

/** One-line fact-sheet string for `text`, or `''` when nothing notable was found. */
export function factSheetText(text: string): string {
  const toks = extractFactSheetTokens(text);
  return toks.length > 0 ? OPEN + toks.join(' · ') + ']' : '';
}
