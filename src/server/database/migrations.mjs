export const migrations = Object.freeze([
  Object.freeze({
    id: 1,
    name: 'create_inventory',
    sql: `
      CREATE TABLE locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
        code TEXT CHECK(code IS NULL OR length(code) <= 40),
        type TEXT NOT NULL CHECK(type IN ('country', 'region', 'city', 'site', 'building', 'floor', 'rack', 'other')),
        parent_id TEXT REFERENCES locations(id) ON DELETE RESTRICT,
        address TEXT CHECK(address IS NULL OR length(address) <= 500),
        notes TEXT CHECK(notes IS NULL OR length(notes) <= 4000),
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX locations_parent_position_idx ON locations(parent_id, position, name COLLATE NOCASE);

      CREATE TABLE usernames (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(username)) BETWEEN 1 AND 128),
        description TEXT CHECK(description IS NULL OR length(description) <= 500),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX usernames_single_default_idx ON usernames(is_default) WHERE is_default = 1;

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL CHECK(length(trim(hostname)) BETWEEN 1 AND 255),
        address TEXT NOT NULL CHECK(length(trim(address)) BETWEEN 1 AND 253),
        normalized_address TEXT NOT NULL,
        username_id TEXT NOT NULL REFERENCES usernames(id) ON DELETE RESTRICT,
        location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
        vendor TEXT NOT NULL CHECK(vendor IN ('fortinet', 'huawei', 'cisco', 'ruckus', 'juniper', 'aruba', 'juniper-mist', 'other')),
        device_type TEXT NOT NULL CHECK(device_type IN ('firewall', 'switch', 'access-point', 'wlan-controller', 'router', 'other')),
        platform TEXT CHECK(platform IS NULL OR length(platform) <= 120),
        notes TEXT CHECK(notes IS NULL OR length(notes) <= 4000),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
        ssh_enabled INTEGER NOT NULL DEFAULT 1 CHECK(ssh_enabled IN (0, 1)),
        ssh_port INTEGER NOT NULL DEFAULT 22 CHECK(ssh_port BETWEEN 1 AND 65535),
        https_enabled INTEGER NOT NULL DEFAULT 0 CHECK(https_enabled IN (0, 1)),
        https_port INTEGER NOT NULL DEFAULT 443 CHECK(https_port BETWEEN 1 AND 65535),
        https_url TEXT,
        algorithm_profile TEXT NOT NULL DEFAULT 'modern' CHECK(algorithm_profile IN ('modern', 'legacy', 'custom')),
        login_mode TEXT NOT NULL DEFAULT 'standard' CHECK(login_mode IN ('standard', 'shell')),
        terminal_type TEXT NOT NULL DEFAULT 'xterm-256color' CHECK(terminal_type IN ('xterm-256color', 'xterm', 'vt100', 'vt220')),
        backspace_mode TEXT NOT NULL DEFAULT 'del' CHECK(backspace_mode IN ('del', 'bs')),
        encoding TEXT NOT NULL DEFAULT 'utf-8' CHECK(encoding IN ('utf-8', 'iso-8859-1')),
        keepalive_interval INTEGER NOT NULL DEFAULT 0 CHECK(keepalive_interval BETWEEN 0 AND 3600),
        keepalive_limit INTEGER NOT NULL DEFAULT 3 CHECK(keepalive_limit BETWEEN 1 AND 100),
        connect_timeout INTEGER NOT NULL DEFAULT 20 CHECK(connect_timeout BETWEEN 1 AND 300),
        last_connected_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(ssh_enabled = 1 OR https_enabled = 1)
      ) STRICT;

      CREATE INDEX devices_location_idx ON devices(location_id, hostname COLLATE NOCASE);
      CREATE INDEX devices_username_idx ON devices(username_id);
      CREATE INDEX devices_address_idx ON devices(normalized_address);
      CREATE INDEX devices_favorite_idx ON devices(favorite, hostname COLLATE NOCASE);
      CREATE INDEX devices_recent_idx ON devices(last_connected_at DESC) WHERE last_connected_at IS NOT NULL;

      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 60),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE device_tags (
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(device_id, tag_id)
      ) STRICT, WITHOUT ROWID;

      CREATE VIRTUAL TABLE device_search USING fts5(
        device_id UNINDEXED,
        hostname,
        address,
        location_path,
        vendor,
        device_type,
        tags,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  }),
  Object.freeze({
    id: 2,
    name: 'add_ssh_security',
    sql: `
      ALTER TABLE devices ADD COLUMN custom_algorithms TEXT
        CHECK(custom_algorithms IS NULL OR json_valid(custom_algorithms));
      ALTER TABLE devices ADD COLUMN post_login_command TEXT;
      ALTER TABLE devices ADD COLUMN post_login_enabled INTEGER NOT NULL DEFAULT 0
        CHECK(post_login_enabled IN (0, 1));

      CREATE TABLE known_hosts (
        id TEXT PRIMARY KEY,
        device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
        host TEXT NOT NULL,
        port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
        key_type TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(host, port)
      ) STRICT;

      CREATE INDEX known_hosts_device_idx ON known_hosts(device_id);
    `,
  }),
  Object.freeze({
    id: 3,
    name: 'add_session_history',
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'https')),
        hostname TEXT NOT NULL,
        address TEXT NOT NULL,
        port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
        username TEXT,
        location_path TEXT,
        vendor TEXT,
        device_type TEXT,
        ticket TEXT CHECK(ticket IS NULL OR length(ticket) <= 120),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
        reason TEXT,
        log_path TEXT,
        sha256 TEXT CHECK(sha256 IS NULL OR length(sha256) = 64),
        host_fingerprint TEXT,
        algorithms TEXT CHECK(algorithms IS NULL OR json_valid(algorithms)),
        recorded INTEGER NOT NULL DEFAULT 0 CHECK(recorded IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX sessions_started_idx ON sessions(started_at DESC);
      CREATE INDEX sessions_device_idx ON sessions(device_id, started_at DESC);
      CREATE INDEX sessions_location_idx ON sessions(location_path, started_at DESC);
      CREATE INDEX sessions_ticket_idx ON sessions(ticket, started_at DESC)
        WHERE ticket IS NOT NULL;
    `,
  }),
  Object.freeze({
    id: 4,
    name: 'add_trusted_certificates',
    sql: `
      CREATE TABLE trusted_certificates (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        host TEXT NOT NULL,
        port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
        fingerprint TEXT NOT NULL,
        subject TEXT,
        issuer TEXT,
        valid_from TEXT,
        valid_to TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(device_id, host, port)
      ) STRICT;

      CREATE INDEX trusted_certificates_host_idx
        ON trusted_certificates(host, port);
    `,
  }),
  Object.freeze({
    id: 5,
    name: 'add_device_health_checks',
    sql: `
      CREATE TABLE device_health_checks (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        checked_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
        overall_status TEXT NOT NULL CHECK(overall_status IN ('online', 'degraded', 'offline')),
        ping_status TEXT NOT NULL CHECK(ping_status IN ('online', 'offline', 'unsupported')),
        ping_latency_ms REAL CHECK(ping_latency_ms IS NULL OR ping_latency_ms >= 0),
        ping_reason TEXT,
        ssh_status TEXT NOT NULL CHECK(ssh_status IN ('online', 'offline', 'disabled')),
        ssh_latency_ms REAL CHECK(ssh_latency_ms IS NULL OR ssh_latency_ms >= 0),
        ssh_reason TEXT,
        https_status TEXT NOT NULL CHECK(https_status IN ('online', 'offline', 'disabled')),
        https_latency_ms REAL CHECK(https_latency_ms IS NULL OR https_latency_ms >= 0),
        https_reason TEXT
      ) STRICT;

      CREATE INDEX device_health_checks_device_idx
        ON device_health_checks(device_id, checked_at DESC);
      CREATE INDEX device_health_checks_checked_idx
        ON device_health_checks(checked_at DESC);
    `,
  }),
  Object.freeze({
    id: 6,
    name: 'add_configuration_snapshots',
    sql: `
      CREATE TABLE configuration_snapshots (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
        source TEXT NOT NULL CHECK(source IN ('manual', 'terminal', 'runbook')),
        content TEXT NOT NULL,
        content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
        line_count INTEGER NOT NULL CHECK(line_count >= 1),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX configuration_snapshots_device_idx
        ON configuration_snapshots(device_id, created_at DESC);
    `,
  }),
  Object.freeze({
    id: 7,
    name: 'add_snapshot_redaction_count',
    sql: `
      ALTER TABLE configuration_snapshots ADD COLUMN redaction_count INTEGER NOT NULL DEFAULT 0
        CHECK(redaction_count >= 0);
    `,
  }),
]);
