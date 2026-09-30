const TERMINAL_PALETTES = Object.freeze({
  dark: Object.freeze({
    custom: Object.freeze({ backgroundColor: '#3b2d12', foregroundColor: '#ffd277' }),
    danger: Object.freeze({ backgroundColor: '#42191f', foregroundColor: '#ff7b82' }),
    speed: Object.freeze({ backgroundColor: '#143650', foregroundColor: '#7acbff' }),
    success: Object.freeze({ backgroundColor: '#123b24', foregroundColor: '#71e59a' }),
    warning: Object.freeze({ backgroundColor: '#42280f', foregroundColor: '#ffb45c' }),
  }),
  'high-contrast': Object.freeze({
    custom: Object.freeze({ backgroundColor: '#332600', foregroundColor: '#ffff00' }),
    danger: Object.freeze({ backgroundColor: '#330006', foregroundColor: '#ff666d' }),
    speed: Object.freeze({ backgroundColor: '#003459', foregroundColor: '#75d1ff' }),
    success: Object.freeze({ backgroundColor: '#003316', foregroundColor: '#00ff66' }),
    warning: Object.freeze({ backgroundColor: '#3b2300', foregroundColor: '#ffbf00' }),
  }),
  light: Object.freeze({
    custom: Object.freeze({ backgroundColor: '#fff0c4', foregroundColor: '#654800' }),
    danger: Object.freeze({ backgroundColor: '#ffe0e2', foregroundColor: '#a91925' }),
    speed: Object.freeze({ backgroundColor: '#dceeff', foregroundColor: '#005b9f' }),
    success: Object.freeze({ backgroundColor: '#ddf6e5', foregroundColor: '#086b2d' }),
    warning: Object.freeze({ backgroundColor: '#ffe8cc', foregroundColor: '#864700' }),
  }),
});

const STATUS_RULES = Object.freeze([
  Object.freeze({ kind: 'danger', pattern: /\b(?:offline|down)\b/giu }),
  Object.freeze({ kind: 'success', pattern: /\b(?:online|up)\b/giu }),
]);
const SPEED_PATTERN = /\b(\d+(?:[.,]\d+)?)\s*(gbps|gbit\/s|mbps|mbit\/s)\b/giu;

function overlaps(existing, start, length) {
  const end = start + length;
  return existing.some((segment) => start < segment.start + segment.length && end > segment.start);
}

function addSegment(segments, palette, kind, start, length) {
  if (length <= 0 || overlaps(segments, start, length)) return;
  segments.push({ ...palette[kind], kind, length, start });
}

export function terminalStylesForText(text, { keywords = [], theme = 'dark' } = {}) {
  const palette = TERMINAL_PALETTES[theme] ?? TERMINAL_PALETTES.dark;
  const segments = [];

  for (const rule of STATUS_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      addSegment(segments, palette, rule.kind, match.index, match[0].length);
    }
  }

  for (const match of text.matchAll(SPEED_PATTERN)) {
    const value = Number.parseFloat(match[1].replace(',', '.'));
    const megabits = match[2].toLocaleLowerCase('en').startsWith('g') ? value * 1_000 : value;
    if (megabits === 100) {
      addSegment(segments, palette, 'warning', match.index, match[0].length);
    } else if (megabits >= 1_000) {
      addSegment(segments, palette, 'speed', match.index, match[0].length);
    }
  }

  const normalizedText = text.toLocaleLowerCase('en');
  for (const rawKeyword of keywords) {
    const keyword = rawKeyword.trim().toLocaleLowerCase('en');
    if (keyword.length === 0) continue;
    let start = normalizedText.indexOf(keyword);
    while (start !== -1) {
      addSegment(segments, palette, 'custom', start, keyword.length);
      start = normalizedText.indexOf(keyword, start + keyword.length);
    }
  }

  return segments.sort((left, right) => left.start - right.start);
}
