const VIEW_GROUPS = Object.freeze({
  devices: 'registration',
  health: 'operation',
  history: 'operation',
  locations: 'registration',
  runbooks: 'operation',
  settings: 'administration',
  snapshots: 'operation',
  trust: 'administration',
  usernames: 'registration',
});

export function navigationGroupForView(view) {
  return VIEW_GROUPS[view];
}

export function sessionNavigationTarget(activeSessionId, sessionIds) {
  if (activeSessionId !== undefined && sessionIds.includes(activeSessionId)) return activeSessionId;
  return sessionIds[0];
}
