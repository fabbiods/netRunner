const LINE_BREAK_PATTERN = /\r\n|\r|\n/gu;
const TRAILING_LINE_BREAK_PATTERN = /(?:\r\n|\r|\n)$/u;
const INPUT_CHUNK_PATTERN = /[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/gu;

export function splitMultilineInput(value) {
  const lineBreakCount = value.match(LINE_BREAK_PATTERN)?.length ?? 0;
  const lineCount = lineBreakCount + (TRAILING_LINE_BREAK_PATTERN.test(value) ? 0 : 1);
  if (lineCount <= 1) return undefined;
  return value.match(INPUT_CHUNK_PATTERN)?.filter((chunk) => chunk.length > 0) ?? [value];
}
