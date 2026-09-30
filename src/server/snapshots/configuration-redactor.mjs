const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/iu;
const SENSITIVE_PATTERNS = Object.freeze([
  /\b(?:password|passwd|secret|shared[- ]?(?:key|secret)|pre[- ]?shared[- ]?key|preshared[- ]?key|passphrase|authentication[- ]?key|privacy[- ]?key|key-string|private-key)\b/iu,
  /\b(?:snmp|snmp-agent|snmp-server)\b.*\bcommunity\b/iu,
  /\b(?:snmp|snmp-agent|snmp-server)\b.*\b(?:user|usm-user)\b.*\b(?:auth|priv|authentication-mode|privacy-mode)\b/iu,
  /\b(?:radius|radius-server|tacacs|tacacs-server)\b.*\bkey\b/iu,
  /\b(?:local-user|usm-user)\b.*\b(?:cipher|irreversible-cipher)\b/iu,
  /^\s*(?:auth-passphrase|priv-passphrase|key)(?:\s+\d+)?\s+\S+/iu,
  /:\/\/[^/\s:@]+:[^@\s]+@/u,
]);

function indentation(line) {
  return /^\s*/u.exec(line)?.[0] ?? '';
}

export function redactSensitiveConfiguration(content) {
  const output = [];
  let privateKey = false;
  let redactionCount = 0;

  for (const line of content.split('\n')) {
    if (privateKey) {
      if (PRIVATE_KEY_END.test(line)) privateKey = false;
      continue;
    }
    if (PRIVATE_KEY_BEGIN.test(line)) {
      output.push(`${indentation(line)}[REDACTED PRIVATE KEY]`);
      privateKey = true;
      redactionCount += 1;
      continue;
    }
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(line))) {
      output.push(`${indentation(line)}[REDACTED SENSITIVE LINE]`);
      redactionCount += 1;
      continue;
    }
    output.push(line);
  }

  return { content: output.join('\n'), redactionCount };
}
