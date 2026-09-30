import xtermHeadless from '@xterm/headless';

const { Terminal } = xtermHeadless;

const PAGER_PATTERNS = [
  /\s*-{2,}\s*More\s*-{2,}\s*/giu,
  /\s*--\s*More\s*--(?:\s*\([^)]*\))?\s*/giu,
  /\s*---\(more\)---\s*/giu,
  /\s*Press (?:any key|RETURN|ENTER|SPACE)[^\r\n]*\s*/giu,
];

function cleanLine(value) {
  let cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  for (const pattern of PAGER_PATTERNS) cleaned = cleaned.replace(pattern, '');
  return cleaned.replace(/[ \t]+$/gu, '');
}

export class TerminalOutputNormalizer {
  constructor({ columns = 100, rows = 30 } = {}) {
    this.terminal = new Terminal({
      allowProposedApi: true,
      cols: columns,
      convertEol: false,
      logLevel: 'off',
      rows,
      scrollback: 100_000,
    });
    this.pendingLineEnds = [];
    this.terminal.onLineFeed(() => {
      const buffer = this.terminal.buffer.active;
      this.pendingLineEnds.push(buffer.baseY + buffer.cursorY - 1);
    });
    for (const identifier of [0, 1, 2, 8, 52]) {
      this.terminal.parser.registerOscHandler(identifier, () => true);
    }
  }

  write(data) {
    return new Promise((resolve) => {
      this.terminal.write(data, () => resolve(this.#takeCompletedLines()));
    });
  }

  resize(columns, rows) {
    this.terminal.resize(columns, rows);
  }

  flush() {
    const buffer = this.terminal.buffer.active;
    const absoluteCursor = buffer.baseY + buffer.cursorY;
    const line = this.#logicalLineEndingAt(absoluteCursor);
    return line === undefined || line.length === 0 ? [] : [line];
  }

  dispose() {
    this.terminal.dispose();
  }

  #takeCompletedLines() {
    const completed = [];
    const seen = new Set();
    const buffer = this.terminal.buffer.active;
    for (const endIndex of this.pendingLineEnds.splice(0)) {
      if (endIndex < 0 || seen.has(endIndex)) continue;
      const nextLine = buffer.getLine(endIndex + 1);
      if (nextLine?.isWrapped) continue;
      const line = this.#logicalLineEndingAt(endIndex);
      if (line !== undefined) completed.push(line);
      seen.add(endIndex);
    }
    return completed;
  }

  #logicalLineEndingAt(endIndex) {
    const buffer = this.terminal.buffer.active;
    const endLine = buffer.getLine(endIndex);
    if (endLine === undefined) return undefined;
    let startIndex = endIndex;
    while (startIndex > 0 && buffer.getLine(startIndex)?.isWrapped) startIndex -= 1;
    let value = '';
    for (let index = startIndex; index <= endIndex; index += 1) {
      value += buffer.getLine(index)?.translateToString(true) ?? '';
    }
    return cleanLine(value);
  }
}
