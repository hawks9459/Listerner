const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Store = require('./listener-session-store.js');
const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function makeFetch(response) {
  const calls = [];
  return {
    calls,
    fetch: async (...args) => {
      calls.push(args);
      return response;
    }
  };
}

test('IDs de sessão são únicos e têm formato UUID', () => {
  const first = Store.createSessionId();
  const second = Store.createSessionId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first, second);
});

test('trilha só é considerada concluída com exatamente os seis desafios válidos', () => {
  const challengeIds = ['sequencing-1', 'sequencing-2', 'repetition-1', 'repetition-2', 'conditionals-1', 'conditionals-2'];
  const progress = Object.fromEntries(challengeIds.map((id) => [id, true]));
  assert.equal(Store.trackIsComplete(progress, challengeIds), true);
  progress['conditionals-2'] = false;
  assert.equal(Store.trackIsComplete(progress, challengeIds), false);
  assert.equal(Store.trackIsComplete(progress, challengeIds.slice(0, 5)), false);
});

test('questionário final contém somente as três avaliações previstas e campo livre opcional', () => {
  const options = [...page.matchAll(/name="experienceRating" value="([^"]+)"><span>([^<]+)<\/span>/g)];
  assert.deepEqual(options.map(([, value, label]) => [value, label]), [
    ['good', 'Bom'],
    ['very-good', 'Muito bom'],
    ['excellent', 'Excelente']
  ]);
  assert.match(page, /id="experienceComment" name="comment" maxlength="500"/);
  assert.match(page, /id="finishSession" type="button" disabled>Finalizar sessão/);
  assert.equal(page.includes('Ruim'), false);
});

test('sem endpoint configurado, nenhum sucesso de armazenamento é simulado', async () => {
  assert.deepEqual(await Store.registerSession({ id: 'session-1' }, async () => {
    throw new Error('Não deveria chamar fetch');
  }), { configured: false, confirmed: false });
});

test('registro inicial e avaliação usam o mesmo identificador e ações idempotentes', async () => {
  global.LISTENER_CONFIG = { sessionEndpoint: 'https://example.test/session' };
  const { calls, fetch } = makeFetch({
    ok: true,
    json: async () => ({ success: true, sessionId: 'session-1' })
  });
  const session = {
    id: 'session-1',
    startedAt: '2026-10-15T12:00:00.000Z',
    player: { name: 'Ana', age: 9, access: { source: 'school', detail: '' } }
  };
  await Store.registerSession(session, fetch);
  await Store.completeSession(session, {
    rating: 'excellent',
    comment: '',
    completedAt: '2026-10-15T13:00:00.000Z',
    track: { status: 'complete', completedChallenges: 6, score: 580 }
  }, fetch);

  assert.equal(calls.length, 2);
  for (const [, options] of calls) {
    assert.deepEqual(options.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
    assert.equal('Idempotency-Key' in options.headers, false);
  }
  const registerBody = JSON.parse(calls[0][1].body);
  const completeBody = JSON.parse(calls[1][1].body);
  assert.equal(registerBody.idempotencyKey, 'session-1:register-session');
  assert.equal(completeBody.idempotencyKey, 'session-1:complete-session');
  assert.equal(completeBody.sessionId, 'session-1');
  assert.equal('comment' in completeBody, false);
});

test('falha de rede mantém o envio pendente e registra apenas a mensagem de erro', async () => {
  global.LISTENER_CONFIG = { sessionEndpoint: 'https://example.test/session' };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.deepEqual(await Store.registerSession({ id: 'session-1' }, async () => {
      throw new Error('Network is unreachable');
    }), { configured: true, confirmed: false, queued: true });
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, [['Falha de rede ao enviar dados da sessão:', 'Network is unreachable']]);
});

test('resposta sem confirmação inequívoca é falha de armazenamento', async () => {
  global.LISTENER_CONFIG = { sessionEndpoint: 'https://example.test/session' };
  await assert.rejects(Store.registerSession({ id: 'session-1' }, async () => ({
    ok: true,
    json: async () => ({ success: true, sessionId: 'different-session' })
  })), /não confirmou/i);
  await assert.rejects(Store.registerSession({ id: 'session-1' }, async () => ({
    ok: false,
    json: async () => ({ success: false })
  })), /não confirmou/i);
});

delete global.LISTENER_CONFIG;
