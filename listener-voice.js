(function (global) {
  'use strict';

  function normalizeSpeech(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseTranscript(rawTranscript, permissions = {}) {
    const transcript = normalizeSpeech(rawTranscript);
    if (/^(senao|se nao)$/.test(transcript)) {
      return permissions.allowConditionals === true ? { type: 'else' } : { type: 'locked', foundation: 'conditionals' };
    }
    if (/^(fim da condicao|encerrar condicao)$/.test(transcript)) {
      return permissions.allowConditionals === true ? { type: 'endCondition' } : { type: 'locked', foundation: 'conditionals' };
    }
    if (/^(fim da repeticao|encerrar repeticao)$/.test(transcript)) {
      return permissions.allowRepeat === true ? { type: 'endRepeat' } : { type: 'locked', foundation: 'repetition' };
    }
    if (/^(fim|fim do bloco|encerrar bloco)$/.test(transcript)) return { type: 'endBlock' };

    const repeatMatch = transcript.match(/^repita(?:\s+(?:por\s+)?(2|3|4|5|dois|duas|tres|quatro|cinco)(?:\s+vezes?)?)?$/);
    if (repeatMatch) {
      if (permissions.allowRepeat !== true) return { type: 'locked', foundation: 'repetition' };
      const counts = { dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };
      return { type: 'repeat', times: Number(repeatMatch[1]) || counts[repeatMatch[1]] || 2 };
    }
    if (/^se\s+(?:o\s+)?caminho(?:\s+a\s+frente)?(?:\s+estiver)?\s+livre$/.test(transcript)) {
      if (permissions.allowConditionals !== true) return { type: 'locked', foundation: 'conditionals' };
      return { type: 'if', condition: 'pathClear' };
    }
    if (/^(avance|avancar|anda|ande|mova|mover)$/.test(transcript)) return { type: 'action', command: 'forward' };
    if (/^(vire\s+(?:a\s+)?direita|direita)$/.test(transcript)) return { type: 'action', command: 'turn90R' };
    if (/^(vire\s+(?:a\s+)?esquerda|esquerda)$/.test(transcript)) return { type: 'action', command: 'turn90L' };
    return { type: 'unknown' };
  }

  const api = Object.freeze({ normalizeSpeech, parseTranscript });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ListenerVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
