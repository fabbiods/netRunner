import { readJsonBody } from '../http-utils.mjs';
import { runbookCatalog } from '../runbooks/runbook-catalog.mjs';

function reply(body, statusCode = 200) {
  return { body, statusCode };
}

function pathId(pathname, pattern) {
  const match = pattern.exec(pathname);
  return match === null ? undefined : decodeURIComponent(match[1]);
}

export async function routeSshApi(request, requestUrl, sessions) {
  const { method = 'GET' } = request;
  const { pathname, searchParams } = requestUrl;

  if (pathname === '/api/runbooks/catalog' && method === 'GET') {
    return reply(runbookCatalog);
  }

  if (pathname === '/api/ssh/sessions') {
    if (method === 'GET') return reply(sessions.list());
    if (method === 'POST') {
      const body = await readJsonBody(request);
      try {
        return reply(sessions.create(body), 201);
      } finally {
        body.password = undefined;
      }
    }
  }

  const eventsId = pathId(pathname, /^\/api\/ssh\/sessions\/([^/]+)\/events$/);
  if (eventsId !== undefined && method === 'GET') {
    return reply({ events: await sessions.get(eventsId).poll(searchParams.get('after') ?? 0) });
  }

  const hostKeyId = pathId(pathname, /^\/api\/ssh\/sessions\/([^/]+)\/host-key$/);
  if (hostKeyId !== undefined && method === 'POST') {
    const body = await readJsonBody(request);
    sessions.get(hostKeyId).decideHostKey({
      accept: body.decision === 'accept',
      fingerprint: body.fingerprint,
      replace: body.replace === true,
    });
    return reply({ accepted: body.decision === 'accept' });
  }

  const promptsId = pathId(pathname, /^\/api\/ssh\/sessions\/([^/]+)\/prompts$/);
  if (promptsId !== undefined && method === 'POST') {
    const body = await readJsonBody(request);
    try {
      sessions.get(promptsId).respondToPrompts(body.promptId, body.answers);
      return reply({ submitted: true });
    } finally {
      if (Array.isArray(body.answers)) body.answers.fill('');
    }
  }

  const inputId = pathId(pathname, /^\/api\/ssh\/sessions\/([^/]+)\/input$/);
  if (inputId !== undefined && method === 'POST') {
    const body = await readJsonBody(request);
    sessions.get(inputId).write(body.data);
    body.data = undefined;
    return reply({ written: true });
  }

  const resizeId = pathId(pathname, /^\/api\/ssh\/sessions\/([^/]+)\/resize$/);
  if (resizeId !== undefined && method === 'POST') {
    const body = await readJsonBody(request);
    sessions.get(resizeId).resize(body.columns, body.rows);
    return reply({ resized: true });
  }

  const runbooksId = pathId(pathname, /^\/api\/ssh\/sessions\/([^/]+)\/runbooks$/);
  if (runbooksId !== undefined && method === 'GET') {
    return reply(sessions.listRunbooks(runbooksId));
  }

  const runbookProfileId = pathId(
    pathname,
    /^\/api\/ssh\/sessions\/([^/]+)\/runbook-profile$/,
  );
  if (runbookProfileId !== undefined && method === 'POST') {
    const body = await readJsonBody(request);
    return reply(sessions.selectRunbookProfile(runbookProfileId, body.profileId));
  }

  const runbookMatch = /^\/api\/ssh\/sessions\/([^/]+)\/runbooks\/([^/]+)$/u.exec(pathname);
  if (runbookMatch !== null && method === 'POST') {
    return reply(
      await sessions.executeRunbook(
        decodeURIComponent(runbookMatch[1]),
        decodeURIComponent(runbookMatch[2]),
      ),
    );
  }

  const startRecordingId = pathId(
    pathname,
    /^\/api\/ssh\/sessions\/([^/]+)\/recording\/start$/,
  );
  if (startRecordingId !== undefined && method === 'POST') {
    return reply(await sessions.get(startRecordingId).startRecording());
  }

  const stopRecordingId = pathId(
    pathname,
    /^\/api\/ssh\/sessions\/([^/]+)\/recording\/stop$/,
  );
  if (stopRecordingId !== undefined && method === 'POST') {
    return reply(await sessions.get(stopRecordingId).stopRecording());
  }

  const sessionId = pathId(pathname, /^\/api\/ssh\/sessions\/([^/]+)$/);
  if (sessionId !== undefined) {
    if (method === 'GET') return reply(sessions.get(sessionId).publicState());
    if (method === 'DELETE') {
      await sessions.remove(sessionId);
      return reply(undefined, 204);
    }
  }

  return undefined;
}
