export const LOCATION_TYPES = Object.freeze([
  'country',
  'region',
  'city',
  'site',
  'building',
  'floor',
  'rack',
  'other',
]);

export const VENDORS = Object.freeze([
  'fortinet',
  'huawei',
  'cisco',
  'ruckus',
  'juniper',
  'aruba',
  'juniper-mist',
  'other',
]);

export const DEVICE_TYPES = Object.freeze([
  'firewall',
  'switch',
  'access-point',
  'wlan-controller',
  'router',
  'other',
]);

export const ALGORITHM_PROFILES = Object.freeze(['modern', 'legacy', 'custom']);
export const LOGIN_MODES = Object.freeze(['standard', 'shell']);
export const TERMINAL_TYPES = Object.freeze(['xterm-256color', 'xterm', 'vt100', 'vt220']);
export const BACKSPACE_MODES = Object.freeze(['del', 'bs']);
export const ENCODINGS = Object.freeze(['utf-8', 'iso-8859-1']);

export const SESSION_SCOPED_COMMANDS = Object.freeze([
  'terminal length 0',
  'screen-length 0 temporary',
  'skip-page-display',
  'set cli screen-length 0',
  'no paging',
  'no page',
]);
