import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../errors.mjs';
import { runInTransaction } from '../database/database.mjs';
import { parseDeviceInput, parseLocationInput, parseUsernameInput } from '../validation.mjs';

function nowIso() {
  return new Date().toISOString();
}

function booleanFromSql(value) {
  return value === 1;
}

function booleanToSql(value) {
  return value ? 1 : 0;
}

function buildLocationMetadata(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pathCache = new Map();

  function pathFor(locationId, visited = new Set()) {
    if (pathCache.has(locationId)) {
      return pathCache.get(locationId);
    }
    if (visited.has(locationId)) {
      throw new ConflictError('Location hierarchy contains a cycle');
    }
    const location = byId.get(locationId);
    if (location === undefined) {
      return '';
    }
    visited.add(locationId);
    const parentPath = location.parent_id === null ? '' : pathFor(location.parent_id, visited);
    visited.delete(locationId);
    const locationPath = parentPath === '' ? location.name : `${parentPath} › ${location.name}`;
    pathCache.set(locationId, locationPath);
    return locationPath;
  }

  return new Map(rows.map((row) => [row.id, pathFor(row.id)]));
}

function mapDevice(row, locationPath) {
  return {
    address: row.address,
    algorithmProfile: row.algorithm_profile,
    backspaceMode: row.backspace_mode,
    connectTimeout: row.connect_timeout,
    createdAt: row.created_at,
    customAlgorithms: row.custom_algorithms === null ? null : JSON.parse(row.custom_algorithms),
    deviceType: row.device_type,
    encoding: row.encoding,
    favorite: booleanFromSql(row.favorite),
    hostname: row.hostname,
    httpsEnabled: booleanFromSql(row.https_enabled),
    httpsPort: row.https_port,
    httpsUrl: row.https_url,
    id: row.id,
    keepaliveInterval: row.keepalive_interval,
    keepaliveLimit: row.keepalive_limit,
    lastConnectedAt: row.last_connected_at,
    locationId: row.location_id,
    locationPath,
    loginMode: row.login_mode,
    notes: row.notes,
    platform: row.platform,
    postLoginCommand: row.post_login_command,
    postLoginEnabled: booleanFromSql(row.post_login_enabled),
    sshEnabled: booleanFromSql(row.ssh_enabled),
    sshPort: row.ssh_port,
    tags:
      row.tags === null || row.tags === ''
        ? []
        : row.tags.split('\u001f').sort((left, right) => left.localeCompare(right, 'pt-BR')),
    terminalType: row.terminal_type,
    updatedAt: row.updated_at,
    username: row.username,
    usernameId: row.username_id,
    vendor: row.vendor,
  };
}

function ftsQuery(search) {
  const tokens = search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

export class InventoryService {
  constructor(database) {
    this.database = database;
  }

  listLocations() {
    const rows = this.database
      .prepare(`
        SELECT l.*,
          (SELECT count(*) FROM devices d WHERE d.location_id = l.id) AS device_count,
          (SELECT count(*) FROM locations c WHERE c.parent_id = l.id) AS child_count
        FROM locations l
        ORDER BY l.position, l.name COLLATE NOCASE
      `)
      .all();
    const paths = buildLocationMetadata(rows);
    return rows.map((row) => ({
      address: row.address,
      childCount: row.child_count,
      code: row.code,
      createdAt: row.created_at,
      deviceCount: row.device_count,
      id: row.id,
      name: row.name,
      notes: row.notes,
      parentId: row.parent_id,
      path: paths.get(row.id),
      position: row.position,
      type: row.type,
      updatedAt: row.updated_at,
    }));
  }

  createLocation(input) {
    const location = parseLocationInput(input);
    this.#assertLocationExists(location.parentId);
    const timestamp = nowIso();
    const id = randomUUID();
    this.database
      .prepare(`
        INSERT INTO locations
          (id, name, code, type, parent_id, address, notes, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        location.name,
        location.code,
        location.type,
        location.parentId,
        location.address,
        location.notes,
        location.position,
        timestamp,
        timestamp,
      );
    return this.listLocations().find((item) => item.id === id);
  }

  updateLocation(id, input) {
    const current = this.#getLocationRow(id);
    const location = parseLocationInput({
      address: input.address === undefined ? current.address : input.address,
      code: input.code === undefined ? current.code : input.code,
      name: input.name === undefined ? current.name : input.name,
      notes: input.notes === undefined ? current.notes : input.notes,
      parentId: input.parentId === undefined ? current.parent_id : input.parentId,
      position: input.position ?? current.position,
      type: input.type ?? current.type,
    });
    this.#assertLocationExists(location.parentId);
    if (location.parentId === id || this.#isDescendant(location.parentId, id)) {
      throw new ConflictError('A location cannot be moved inside itself or one of its descendants');
    }

    runInTransaction(this.database, () => {
      this.database
        .prepare(`
          UPDATE locations
          SET name = ?, code = ?, type = ?, parent_id = ?, address = ?, notes = ?, position = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          location.name,
          location.code,
          location.type,
          location.parentId,
          location.address,
          location.notes,
          location.position,
          nowIso(),
          id,
        );
      this.#refreshAllSearchEntries();
    });
    return this.listLocations().find((item) => item.id === id);
  }

  deleteLocation(id, destinationLocationId) {
    this.#getLocationRow(id);
    const childCount = this.database
      .prepare('SELECT count(*) AS count FROM locations WHERE parent_id = ?')
      .get(id).count;
    const deviceCount = this.database
      .prepare('SELECT count(*) AS count FROM devices WHERE location_id = ?')
      .get(id).count;

    if (childCount + deviceCount > 0) {
      if (destinationLocationId === undefined || destinationLocationId === null) {
        throw new ConflictError('A destination is required to delete a non-empty location', {
          childCount,
          deviceCount,
        });
      }
      this.#assertLocationExists(destinationLocationId);
      if (destinationLocationId === id || this.#isDescendant(destinationLocationId, id)) {
        throw new ConflictError('The destination cannot be the deleted location or its descendant');
      }
    }

    runInTransaction(this.database, () => {
      if (childCount > 0) {
        this.database
          .prepare('UPDATE locations SET parent_id = ?, updated_at = ? WHERE parent_id = ?')
          .run(destinationLocationId, nowIso(), id);
      }
      if (deviceCount > 0) {
        this.database
          .prepare('UPDATE devices SET location_id = ?, updated_at = ? WHERE location_id = ?')
          .run(destinationLocationId, nowIso(), id);
      }
      this.database.prepare('DELETE FROM locations WHERE id = ?').run(id);
      this.#refreshAllSearchEntries();
    });
  }

  listUsernames() {
    return this.database
      .prepare(`
        SELECT u.*,
          (SELECT count(*) FROM devices d WHERE d.username_id = u.id) AS device_count
        FROM usernames u
        ORDER BY u.is_default DESC, u.username COLLATE NOCASE
      `)
      .all()
      .map((row) => ({
        createdAt: row.created_at,
        description: row.description,
        deviceCount: row.device_count,
        id: row.id,
        isDefault: booleanFromSql(row.is_default),
        updatedAt: row.updated_at,
        username: row.username,
      }));
  }

  createUsername(input) {
    const username = parseUsernameInput(input);
    if (
      this.database.prepare('SELECT 1 FROM usernames WHERE username = ? COLLATE NOCASE').get(username.username)
    ) {
      throw new ConflictError('Username already exists');
    }
    const hasUsernames = this.database.prepare('SELECT 1 FROM usernames LIMIT 1').get() !== undefined;
    const isDefault = username.isDefault || !hasUsernames;
    const timestamp = nowIso();
    const id = randomUUID();

    runInTransaction(this.database, () => {
      if (isDefault) {
        this.database.prepare('UPDATE usernames SET is_default = 0, updated_at = ?').run(timestamp);
      }
      this.database
        .prepare(`
          INSERT INTO usernames (id, username, description, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          username.username,
          username.description,
          booleanToSql(isDefault),
          timestamp,
          timestamp,
        );
    });
    return this.listUsernames().find((item) => item.id === id);
  }

  updateUsername(id, input) {
    const current = this.#getUsernameRow(id);
    const username = parseUsernameInput({
      description: input.description === undefined ? current.description : input.description,
      isDefault: input.isDefault ?? booleanFromSql(current.is_default),
      username: input.username ?? current.username,
    });
    const duplicate = this.database
      .prepare('SELECT id FROM usernames WHERE username = ? COLLATE NOCASE AND id <> ?')
      .get(username.username, id);
    if (duplicate !== undefined) {
      throw new ConflictError('Username already exists');
    }
    if (!username.isDefault && booleanFromSql(current.is_default)) {
      throw new ConflictError('Choose another default username before removing the current default');
    }

    runInTransaction(this.database, () => {
      if (username.isDefault) {
        this.database
          .prepare('UPDATE usernames SET is_default = 0, updated_at = ? WHERE id <> ?')
          .run(nowIso(), id);
      }
      this.database
        .prepare(`
          UPDATE usernames SET username = ?, description = ?, is_default = ?, updated_at = ? WHERE id = ?
        `)
        .run(
          username.username,
          username.description,
          booleanToSql(username.isDefault),
          nowIso(),
          id,
        );
    });
    return this.listUsernames().find((item) => item.id === id);
  }

  deleteUsername(id, replacementUsernameId) {
    const current = this.#getUsernameRow(id);
    const deviceCount = this.database
      .prepare('SELECT count(*) AS count FROM devices WHERE username_id = ?')
      .get(id).count;
    if (deviceCount > 0) {
      if (replacementUsernameId === undefined || replacementUsernameId === null) {
        throw new ConflictError('A replacement username is required', { deviceCount });
      }
      if (replacementUsernameId === id) {
        throw new ConflictError('Replacement username must be different');
      }
      this.#getUsernameRow(replacementUsernameId);
    }

    runInTransaction(this.database, () => {
      if (deviceCount > 0) {
        this.database
          .prepare('UPDATE devices SET username_id = ?, updated_at = ? WHERE username_id = ?')
          .run(replacementUsernameId, nowIso(), id);
      }
      this.database.prepare('DELETE FROM usernames WHERE id = ?').run(id);

      if (booleanFromSql(current.is_default)) {
        const next = this.database
          .prepare('SELECT id FROM usernames ORDER BY username COLLATE NOCASE LIMIT 1')
          .get();
        if (next !== undefined) {
          this.database
            .prepare('UPDATE usernames SET is_default = 1, updated_at = ? WHERE id = ?')
            .run(nowIso(), next.id);
        }
      }
    });
  }

  listDevices({
    algorithmProfile,
    favorites = false,
    id,
    limit = 200,
    locationId,
    recent = false,
    search = '',
  } = {}) {
    const conditions = [];
    const parameters = [];
    if (algorithmProfile !== undefined) {
      conditions.push('d.algorithm_profile = ?');
      parameters.push(algorithmProfile);
    }
    if (favorites) {
      conditions.push('d.favorite = 1');
    }
    if (id !== undefined) {
      conditions.push('d.id = ?');
      parameters.push(id);
    }
    if (locationId !== undefined) {
      conditions.push('d.location_id = ?');
      parameters.push(locationId);
    }
    if (search.trim() !== '') {
      conditions.push('d.id IN (SELECT device_id FROM device_search WHERE device_search MATCH ?)');
      parameters.push(ftsQuery(search));
    }
    if (recent) {
      conditions.push('d.last_connected_at IS NOT NULL');
    }
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 20_000));
    parameters.push(safeLimit);
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const order = recent
      ? 'd.last_connected_at DESC, d.hostname COLLATE NOCASE'
      : 'd.favorite DESC, d.hostname COLLATE NOCASE';

    const rows = this.database
      .prepare(`
        SELECT d.*, u.username,
          group_concat(t.name, char(31)) AS tags
        FROM devices d
        JOIN usernames u ON u.id = d.username_id
        LEFT JOIN device_tags dt ON dt.device_id = d.id
        LEFT JOIN tags t ON t.id = dt.tag_id
        ${where}
        GROUP BY d.id
        ORDER BY ${order}
        LIMIT ?
      `)
      .all(...parameters);
    const locations = this.database.prepare('SELECT id, name, parent_id FROM locations').all();
    const paths = buildLocationMetadata(locations);
    return rows.map((row) => mapDevice(row, paths.get(row.location_id) ?? ''));
  }

  getDevice(id) {
    const device = this.listDevices({ id, limit: 1 })[0];
    if (device === undefined) {
      throw new NotFoundError('Device');
    }
    return device;
  }

  createDevice(input) {
    const device = parseDeviceInput(input);
    this.#assertDeviceReferences(device);
    const id = randomUUID();
    const timestamp = nowIso();
    runInTransaction(this.database, () => {
      this.#writeDevice(id, device, timestamp, timestamp, null);
      this.#replaceDeviceTags(id, device.tags, timestamp);
      this.#refreshSearchEntry(id);
    });
    return { device: this.getDevice(id), warnings: this.#duplicateWarnings(device.normalizedAddress, id) };
  }

  updateDevice(id, input) {
    const current = this.getDevice(id);
    const device = parseDeviceInput({ ...current, ...input });
    this.#assertDeviceReferences(device);
    runInTransaction(this.database, () => {
      this.#writeDevice(id, device, current.createdAt, nowIso(), current.lastConnectedAt, true);
      this.#replaceDeviceTags(id, device.tags, nowIso());
      this.#refreshSearchEntry(id);
    });
    return { device: this.getDevice(id), warnings: this.#duplicateWarnings(device.normalizedAddress, id) };
  }

  deleteDevice(id) {
    if (this.database.prepare('SELECT 1 FROM devices WHERE id = ?').get(id) === undefined) {
      throw new NotFoundError('Device');
    }
    runInTransaction(this.database, () => {
      this.database.prepare('DELETE FROM device_search WHERE device_id = ?').run(id);
      this.database.prepare('DELETE FROM devices WHERE id = ?').run(id);
      this.database
        .prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM device_tags)')
        .run();
    });
  }

  bulkUpdateDevices(ids, changes) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000) {
      throw new ConflictError('Bulk update requires between 1 and 1000 device IDs');
    }
    const uniqueIds = [...new Set(ids)];
    const allowed = ['algorithmProfile', 'favorite', 'locationId', 'usernameId'];
    if (!allowed.some((field) => changes[field] !== undefined)) {
      throw new ConflictError('Bulk update has no supported changes');
    }

    runInTransaction(this.database, () => {
      for (const id of uniqueIds) {
        const current = this.getDevice(id);
        const next = parseDeviceInput({ ...current, ...changes });
        this.#assertDeviceReferences(next);
        this.#writeDevice(id, next, current.createdAt, nowIso(), current.lastConnectedAt, true);
        this.#replaceDeviceTags(id, next.tags, nowIso());
        this.#refreshSearchEntry(id);
      }
    });
    return uniqueIds.map((id) => this.getDevice(id));
  }

  markDeviceConnected(id) {
    this.getDevice(id);
    this.database
      .prepare('UPDATE devices SET last_connected_at = ?, updated_at = ? WHERE id = ?')
      .run(nowIso(), nowIso(), id);
    return this.getDevice(id);
  }

  getSummary() {
    return {
      devices: this.database.prepare('SELECT count(*) AS count FROM devices').get().count,
      favorites: this.database.prepare('SELECT count(*) AS count FROM devices WHERE favorite = 1').get()
        .count,
      legacy: this.database
        .prepare("SELECT count(*) AS count FROM devices WHERE algorithm_profile = 'legacy'")
        .get().count,
      locations: this.database.prepare('SELECT count(*) AS count FROM locations').get().count,
      usernames: this.database.prepare('SELECT count(*) AS count FROM usernames').get().count,
    };
  }

  exportInventory() {
    return {
      exportedAt: nowIso(),
      formatVersion: 1,
      locations: this.listLocations(),
      usernames: this.listUsernames(),
      devices: this.listDevices({ limit: 20_000 }),
    };
  }

  #assertLocationExists(id) {
    if (id !== null && this.database.prepare('SELECT 1 FROM locations WHERE id = ?').get(id) === undefined) {
      throw new NotFoundError('Parent location');
    }
  }

  #assertDeviceReferences(device) {
    if (this.database.prepare('SELECT 1 FROM locations WHERE id = ?').get(device.locationId) === undefined) {
      throw new NotFoundError('Location');
    }
    if (this.database.prepare('SELECT 1 FROM usernames WHERE id = ?').get(device.usernameId) === undefined) {
      throw new NotFoundError('Username');
    }
  }

  #getLocationRow(id) {
    const row = this.database.prepare('SELECT * FROM locations WHERE id = ?').get(id);
    if (row === undefined) {
      throw new NotFoundError('Location');
    }
    return row;
  }

  #getUsernameRow(id) {
    const row = this.database.prepare('SELECT * FROM usernames WHERE id = ?').get(id);
    if (row === undefined) {
      throw new NotFoundError('Username');
    }
    return row;
  }

  #isDescendant(candidateId, ancestorId) {
    let cursor = candidateId;
    const visited = new Set();
    while (cursor !== null && cursor !== undefined) {
      if (cursor === ancestorId) {
        return true;
      }
      if (visited.has(cursor)) {
        throw new ConflictError('Location hierarchy contains a cycle');
      }
      visited.add(cursor);
      const row = this.database.prepare('SELECT parent_id FROM locations WHERE id = ?').get(cursor);
      cursor = row?.parent_id;
    }
    return false;
  }

  #writeDevice(id, device, createdAt, updatedAt, lastConnectedAt, update = false) {
    const values = [
      device.hostname,
      device.address,
      device.normalizedAddress,
      device.usernameId,
      device.locationId,
      device.vendor,
      device.deviceType,
      device.platform,
      device.notes,
      booleanToSql(device.favorite),
      booleanToSql(device.sshEnabled),
      device.sshPort,
      booleanToSql(device.httpsEnabled),
      device.httpsPort,
      device.httpsUrl,
      device.algorithmProfile,
      device.loginMode,
      device.terminalType,
      device.backspaceMode,
      device.encoding,
      device.keepaliveInterval,
      device.keepaliveLimit,
      device.connectTimeout,
      lastConnectedAt,
      createdAt,
      updatedAt,
      device.customAlgorithms === null ? null : JSON.stringify(device.customAlgorithms),
      device.postLoginCommand,
      booleanToSql(device.postLoginEnabled),
    ];

    if (update) {
      this.database
        .prepare(`
          UPDATE devices SET
            hostname = ?, address = ?, normalized_address = ?, username_id = ?, location_id = ?,
            vendor = ?, device_type = ?, platform = ?, notes = ?, favorite = ?, ssh_enabled = ?,
            ssh_port = ?, https_enabled = ?, https_port = ?, https_url = ?, algorithm_profile = ?,
            login_mode = ?, terminal_type = ?, backspace_mode = ?, encoding = ?, keepalive_interval = ?,
            keepalive_limit = ?, connect_timeout = ?, last_connected_at = ?, created_at = ?, updated_at = ?,
            custom_algorithms = ?, post_login_command = ?, post_login_enabled = ?
          WHERE id = ?
        `)
        .run(...values, id);
    } else {
      this.database
        .prepare(`
          INSERT INTO devices (
            id, hostname, address, normalized_address, username_id, location_id, vendor, device_type,
            platform, notes, favorite, ssh_enabled, ssh_port, https_enabled, https_port, https_url,
            algorithm_profile, login_mode, terminal_type, backspace_mode, encoding, keepalive_interval,
            keepalive_limit, connect_timeout, last_connected_at, created_at, updated_at, custom_algorithms,
            post_login_command, post_login_enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(id, ...values);
    }
  }

  #replaceDeviceTags(deviceId, tagNames, timestamp) {
    this.database.prepare('DELETE FROM device_tags WHERE device_id = ?').run(deviceId);
    const insertTag = this.database.prepare(
      'INSERT OR IGNORE INTO tags (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    );
    const getTag = this.database.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
    const linkTag = this.database.prepare(
      'INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)',
    );
    for (const tagName of tagNames) {
      insertTag.run(randomUUID(), tagName, timestamp, timestamp);
      linkTag.run(deviceId, getTag.get(tagName).id);
    }
    this.database
      .prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM device_tags)')
      .run();
  }

  #refreshSearchEntry(deviceId) {
    this.database.prepare('DELETE FROM device_search WHERE device_id = ?').run(deviceId);
    const device = this.database
      .prepare(`
        SELECT d.*, group_concat(t.name, ' ') AS tags
        FROM devices d
        LEFT JOIN device_tags dt ON dt.device_id = d.id
        LEFT JOIN tags t ON t.id = dt.tag_id
        WHERE d.id = ?
        GROUP BY d.id
      `)
      .get(deviceId);
    if (device === undefined) {
      return;
    }
    const paths = buildLocationMetadata(
      this.database.prepare('SELECT id, name, parent_id FROM locations').all(),
    );
    this.database
      .prepare(`
        INSERT INTO device_search
          (device_id, hostname, address, location_path, vendor, device_type, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        device.id,
        device.hostname,
        device.address,
        paths.get(device.location_id) ?? '',
        device.vendor,
        device.device_type,
        device.tags ?? '',
      );
  }

  #refreshAllSearchEntries() {
    const deviceIds = this.database.prepare('SELECT id FROM devices').all();
    this.database.prepare('DELETE FROM device_search').run();
    for (const row of deviceIds) {
      this.#refreshSearchEntry(row.id);
    }
  }

  #duplicateWarnings(normalizedAddress, currentId) {
    const duplicates = this.database
      .prepare('SELECT id, hostname FROM devices WHERE normalized_address = ? AND id <> ?')
      .all(normalizedAddress, currentId);
    return duplicates.length === 0
      ? []
      : [{ code: 'duplicate_address', devices: duplicates, message: 'Este endereço já está cadastrado.' }];
  }
}
