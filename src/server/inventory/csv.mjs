import { ApplicationError } from '../errors.mjs';

function detectDelimiter(text) {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const character of firstLine) {
    if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ',') {
      commas += 1;
    } else if (!quoted && character === ';') {
      semicolons += 1;
    }
  }
  return semicolons > commas ? ';' : ',';
}

export function parseCsv(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new ApplicationError('CSV content is required', {
      code: 'validation_error',
      statusCode: 422,
    });
  }
  const source = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(source);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new ApplicationError('CSV has an unterminated quoted field', {
      code: 'validation_error',
      statusCode: 422,
    });
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value !== '')) {
    rows.push(row);
  }
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) {
    throw new ApplicationError('CSV contains duplicate headers', {
      code: 'validation_error',
      statusCode: 422,
    });
  }
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])),
  );
}

function escapeCsv(value, delimiter) {
  const text = value === null || value === undefined ? '' : String(value);
  return /["\r\n,;]/.test(text) || text.includes(delimiter)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

export function writeCsv(headers, rows, delimiter = ';') {
  const lines = [headers.join(delimiter)];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header], delimiter)).join(delimiter));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}
