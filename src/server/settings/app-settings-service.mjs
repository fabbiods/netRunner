import { runInTransaction } from '../database/database.mjs';
import { ApplicationError } from '../errors.mjs';

const DEFINITIONS = Object.freeze({
  'appearance.theme': Object.freeze({ defaultValue: 'dark', type: 'theme' }),
  'locale.current': Object.freeze({ defaultValue: 'pt-BR', type: 'locale' }),
  'security.idle_disconnect_minutes': Object.freeze({ defaultValue: 0, maximum: 480, minimum: 0, type: 'integer' }),
  'recording.default': Object.freeze({ defaultValue: true, type: 'boolean' }),
  'terminal.copy_on_select': Object.freeze({ defaultValue: false, type: 'boolean' }),
  'terminal.font_size': Object.freeze({ defaultValue: 13, maximum: 24, minimum: 9, type: 'integer' }),
  'terminal.highlight_keywords': Object.freeze({
    defaultValue: ['down', 'error', 'fail', 'critical', '%LINK-3-UPDOWN'],
    type: 'keywords',
  }),
  'terminal.paste_delay_ms': Object.freeze({ defaultValue: 25, maximum: 2_000, minimum: 0, type: 'integer' }),
  'terminal.right_click_paste': Object.freeze({ defaultValue: false, type: 'boolean' }),
  'terminal.scrollback': Object.freeze({ defaultValue: 20_000, maximum: 100_000, minimum: 1_000, type: 'integer' }),
});

const PUBLIC_NAMES = Object.freeze({
  'appearance.theme': 'theme',
  'locale.current': 'locale',
  'security.idle_disconnect_minutes': 'idleDisconnectMinutes',
  'recording.default': 'recordingDefault',
  'terminal.copy_on_select': 'copyOnSelect',
  'terminal.font_size': 'terminalFontSize',
  'terminal.highlight_keywords': 'highlightKeywords',
  'terminal.paste_delay_ms': 'pasteDelayMs',
  'terminal.right_click_paste': 'rightClickPaste',
  'terminal.scrollback': 'terminalScrollback',
});

function validationError(field, message) {
  return new ApplicationError('Validation failed', {
    code: 'validation_error',
    details: { field, message },
    statusCode: 422,
  });
}

function validate(value, definition, field) {
  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') throw validationError(field, 'must be a boolean');
    return value;
  }
  if (definition.type === 'integer') {
    if (!Number.isInteger(value) || value < definition.minimum || value > definition.maximum) {
      throw validationError(
        field,
        `must be an integer between ${definition.minimum} and ${definition.maximum}`,
      );
    }
    return value;
  }
  if (definition.type === 'theme') {
    if (!['dark', 'light', 'high-contrast'].includes(value)) {
      throw validationError(field, 'must be dark, light or high-contrast');
    }
    return value;
  }
  if (definition.type === 'locale') {
    if (!['pt-BR', 'es', 'en'].includes(value)) {
      throw validationError(field, 'must be pt-BR, es or en');
    }
    return value;
  }
  if (!Array.isArray(value) || value.length > 30) {
    throw validationError(field, 'must be an array with at most 30 keywords');
  }
  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      item.trim().length === 0 ||
      item.trim().length > 60 ||
      /[\u0000-\u001f\u007f]/u.test(item)
    ) {
      throw validationError(field, 'keywords must contain between 1 and 60 valid characters');
    }
    const keyword = item.trim();
    const identity = keyword.toLocaleLowerCase('en');
    if (!seen.has(identity)) normalized.push(keyword);
    seen.add(identity);
  }
  return normalized;
}

function decode(row, definition) {
  if (row === undefined) return structuredClone(definition.defaultValue);
  try {
    return validate(JSON.parse(row.value), definition, row.key);
  } catch {
    return structuredClone(definition.defaultValue);
  }
}

export class AppSettingsService {
  constructor(database) {
    this.database = database;
    this.listeners = new Set();
    const select = database.prepare('SELECT key, value FROM settings WHERE key = ?');
    const insert = database.prepare(`INSERT INTO settings (key, value, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`);
    const now = new Date().toISOString();
    runInTransaction(database, () => {
      for (const [key, definition] of Object.entries(DEFINITIONS)) {
        if (select.get(key) === undefined) {
          insert.run(key, JSON.stringify(definition.defaultValue), now, now);
        }
      }
    });
  }

  getAll() {
    const result = {};
    const select = this.database.prepare('SELECT key, value FROM settings WHERE key = ?');
    for (const [key, definition] of Object.entries(DEFINITIONS)) {
      result[PUBLIC_NAMES[key]] = decode(select.get(key), definition);
    }
    return result;
  }

  update(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw validationError('settings', 'must be an object');
    }
    const byPublicName = new Map(
      Object.entries(PUBLIC_NAMES).map(([key, publicName]) => [publicName, key]),
    );
    const changes = [];
    for (const [publicName, value] of Object.entries(input)) {
      const key = byPublicName.get(publicName);
      if (key === undefined) throw validationError(publicName, 'is not a supported setting');
      changes.push([key, validate(value, DEFINITIONS[key], publicName)]);
    }
    const update = this.database.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?');
    const now = new Date().toISOString();
    runInTransaction(this.database, () => {
      for (const [key, value] of changes) update.run(JSON.stringify(value), now, key);
    });
    const settings = this.getAll();
    for (const listener of this.listeners) listener(settings);
    return settings;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
