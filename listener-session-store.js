(function (global) {
  'use strict';

  function endpoint() {
    const value = global.LISTENER_CONFIG?.sessionEndpoint;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function createSessionId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    global.crypto?.getRandomValues?.(bytes);
    if (!bytes.some(Boolean)) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function trackIsComplete(completedChallenges, challengeIds) {
    return Array.isArray(challengeIds) && challengeIds.length === 6 &&
      challengeIds.every((id) => completedChallenges?.[id] === true);
  }

  async function send(action, record, fetcher = global.fetch) {
    const url = endpoint();
    if (!url) return { configured: false, confirmed: false };
    let parsedUrl;
    try {
      parsedUrl = new URL(url, global.location?.href);
    } catch (_) {
      throw new Error('O endereço do serviço de armazenamento está inválido.');
    }
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
    if (parsedUrl.protocol !== 'https:' && !(localHost && parsedUrl.protocol === 'http:')) {
      throw new Error('O serviço de armazenamento precisa usar HTTPS.');
    }
    if (typeof fetcher !== 'function') throw new Error('Este navegador não oferece suporte ao envio de dados.');
    let response;
    try {
      response = await fetcher(parsedUrl.href, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        keepalive: true,
        body: JSON.stringify({
          action,
          ...record,
          idempotencyKey: [record.sessionId, action, record.revision].filter(value => value !== undefined).join(':')
        })
      });
    } catch (error) {
      console.warn('Falha de rede ao enviar dados da sessão:', error?.message || String(error));
      return { configured: true, confirmed: false, queued: true };
    }
    let result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error('O serviço de registro retornou uma resposta inválida.');
    }
    if (!response.ok || result?.success !== true || result.sessionId !== record.sessionId) {
      throw new Error(typeof result?.message === 'string' && result.message
        ? result.message
        : 'O serviço não confirmou o registro desta sessão.');
    }
    return { configured: true, confirmed: true };
  }

  async function registerSession(session, fetcher) {
    return send('register-session', {
      sessionId: session.id,
      startedAt: session.startedAt,
      participant: session.player
    }, fetcher);
  }

  async function completeSession(session, completion, fetcher) {
    return send('complete-session', {
      sessionId: session.id,
      rating: completion.rating,
      ...(completion.comment ? { comment: completion.comment } : {}),
      completedAt: completion.completedAt,
      track: completion.track
    }, fetcher);
  }

  const keyPrefix = 'listener:sheet:v1:';
  const pending = new Map();
  const inFlight = new Set();

  function queueCheckpoint(record) {
    if (!endpoint()) return;
    const key = keyPrefix + record.sessionId;
    pending.set(key, record);
    try { global.localStorage.setItem(key, JSON.stringify(record)); } catch (_) { /* Retry in memory. */ }
    void flushCheckpoint(key);
  }

  async function flushCheckpoint(key) {
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      while (pending.has(key)) {
        const record = pending.get(key);
        const result = await send('save-checkpoint', record);
        if (!result.confirmed) break;
        global.dispatchEvent(new CustomEvent('listener:checkpoint-saved', { detail: record.sessionId }));
        if (pending.get(key) !== record) continue;
        pending.delete(key);
        try {
          const saved = JSON.parse(global.localStorage.getItem(key));
          if (saved?.revision === record.revision) global.localStorage.removeItem(key);
        } catch (_) { /* Storage can be unavailable in private browsing. */ }
      }
    } catch (error) {
      console.warn('Registro da partida pendente:', error.message);
    } finally {
      inFlight.delete(key);
    }
  }

  function retryPending() {
    if (!endpoint()) return;
    try {
      const storage = global.localStorage;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(keyPrefix)) continue;
        const record = JSON.parse(storage.getItem(key));
        if (record && (!pending.has(key) || record.revision > pending.get(key).revision)) {
          pending.set(key, record);
        }
      }
    } catch (_) { /* Pending in-memory records can still be sent. */ }
    for (const key of pending.keys()) void flushCheckpoint(key);
  }

  if (typeof window !== 'undefined') {
    global.addEventListener('online', retryPending);
    global.addEventListener('pageshow', retryPending);
    global.setInterval(retryPending, 30000);
  }

  const api = Object.freeze({ endpoint, createSessionId, trackIsComplete, registerSession, completeSession, queueCheckpoint });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ListenerSessionStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
