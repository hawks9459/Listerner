const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTranscript } = require('./listener-voice.js');
const sequencing = { allowRepeat: false, allowConditionals: false };
const repetition = { allowRepeat: true, allowConditionals: false };
const conditionals = { allowRepeat: true, allowConditionals: true };

test('frases de condicionais reconhecidas formam uma árvore Então/Senão canônica', () => {
  const program = [];
  let open = null;
  [
    ['Se o caminho estiver livre.', 'if'],
    ['Avance.', 'then'],
    ['Senão.', 'else'],
    ['Vire à esquerda.', 'actionElse'],
    ['Fim da condição.', 'close']
  ].forEach(([phrase, expected]) => {
    const parsed = parseTranscript(phrase, conditionals);
    if (expected === 'if') {
      assert.deepEqual(parsed, { type: 'if', condition: 'pathClear' });
      open = { type: 'if', condition: parsed.condition, then: [], else: [] };
      program.push(open);
    } else if (expected === 'then') {
      assert.deepEqual(parsed, { type: 'action', command: 'forward' });
      open.then.push({ type: parsed.command });
    } else if (expected === 'else') {
      assert.deepEqual(parsed, { type: 'else' });
      open.branch = 'else';
    } else if (expected === 'close') {
      assert.deepEqual(parsed, { type: 'endCondition' });
      delete open.branch;
      open = null;
    } else if (expected === 'actionElse') {
      assert.deepEqual(parsed, { type: 'action', command: 'turn90L' });
      open[open.branch].push({ type: parsed.command });
    }
  });

  assert.equal(open, null);
  assert.deepEqual(program, [{
    type: 'if',
    condition: 'pathClear',
    then: [{ type: 'forward' }],
    else: [{ type: 'turn90L' }]
  }]);
});

test('voz aceita as ações e parâmetros de repetição apresentados na interface', () => {
  assert.deepEqual(parseTranscript('avance', sequencing), { type: 'action', command: 'forward' });
  assert.deepEqual(parseTranscript('Vire à direita.', sequencing), { type: 'action', command: 'turn90R' });
  assert.deepEqual(parseTranscript('Repita três vezes.', repetition), { type: 'repeat', times: 3 });
  assert.deepEqual(parseTranscript('Fim da repetição.', repetition), { type: 'endRepeat' });
});

test('voz não aceita pathBlocked como condição independente nem executa frases desconhecidas', () => {
  assert.deepEqual(parseTranscript('Se caminho bloqueado.', conditionals), { type: 'unknown' });
  assert.deepEqual(parseTranscript('Faça qualquer coisa.', conditionals), { type: 'unknown' });
});

test('voz bloqueia estruturas futuras de acordo com a progressão da trilha', () => {
  assert.deepEqual(parseTranscript('Repita três vezes.', sequencing), { type: 'locked', foundation: 'repetition' });
  assert.deepEqual(parseTranscript('Fim da repetição.', sequencing), { type: 'locked', foundation: 'repetition' });
  assert.deepEqual(parseTranscript('Se o caminho estiver livre.', sequencing), { type: 'locked', foundation: 'conditionals' });
  assert.deepEqual(parseTranscript('Senão.', repetition), { type: 'locked', foundation: 'conditionals' });
  assert.deepEqual(parseTranscript('Fim da condição.', repetition), { type: 'locked', foundation: 'conditionals' });
  assert.deepEqual(parseTranscript('Repita três vezes.', repetition), { type: 'repeat', times: 3 });
  assert.deepEqual(parseTranscript('Se o caminho estiver livre.', conditionals), { type: 'if', condition: 'pathClear' });
});
