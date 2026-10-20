const test = require('node:test');
const assert = require('node:assert/strict');
const Learning = require('./listener-learning.js');
const Missions = require('./listener-missions.js');

const challengeIds = Object.keys(Missions.CHALLENGES);
const foundations = [
  { key: 'sequencing', label: 'Sequenciamento', challengeIds: ['sequencing-1', 'sequencing-2'] },
  { key: 'repetition', label: 'Repetição', challengeIds: ['repetition-1', 'repetition-2'] },
  { key: 'conditionals', label: 'Condicionais', challengeIds: ['conditionals-1', 'conditionals-2'] }
];

function validResult(challenge) {
  return {
    valid: true,
    result: 'complete',
    reached: true,
    state: { robot: { ...challenge.destination.position } }
  };
}

test('pontos são concedidos somente após conclusão real e validação pedagógica', () => {
  const state = Learning.createState(challengeIds);
  const challenge = Missions.CHALLENGES['sequencing-1'];
  const incomplete = Learning.awardCompletion(state, challenge, { ...validResult(challenge), result: 'incomplete' }, { valid: true }, 12, foundations);
  assert.equal(incomplete.accepted, false);
  assert.equal(Learning.scoreTotal(state), 0);

  const completed = Learning.awardCompletion(state, challenge, validResult(challenge), { valid: true }, 12, foundations);
  assert.equal(completed.accepted, true);
  assert.equal(completed.points, 100);
  assert.equal(Learning.scoreTotal(state), 100);
});

test('tentativas repetidas não descontam pontos e conclusão duplicada não pontua de novo', () => {
  const state = Learning.createState(challengeIds);
  const challenge = Missions.CHALLENGES['sequencing-1'];
  Learning.awardCompletion(state, challenge, validResult(challenge), { valid: true }, 12, foundations);
  const duplicate = Learning.awardCompletion(state, challenge, validResult(challenge), { valid: true }, 12, foundations);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.alreadyCompleted, true);
  assert.equal(Learning.scoreTotal(state), 100);
});

test('dicas não penalizam 6–11 anos e três dicas limitam penalização a 30 pontos', () => {
  const young = Learning.createState(challengeIds);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(Learning.useHint(young, 'sequencing-1', 8).penalty, 0);
  }
  const older = Learning.createState(challengeIds);
  for (let index = 1; index <= 3; index += 1) {
    const hint = Learning.useHint(older, 'sequencing-1', 12);
    assert.equal(hint.penalty, index * 10);
  }
  assert.equal(Learning.useHint(older, 'sequencing-1', 12).accepted, false);
  const challenge = Missions.CHALLENGES['sequencing-1'];
  const awarded = Learning.awardCompletion(older, challenge, validResult(challenge), { valid: true }, 12, foundations);
  assert.equal(awarded.points, 70);
  assert.equal(awarded.penalty, 30);
});

test('configuração de progresso recupera conclusões legadas sem inventar pontos', () => {
  const restored = Learning.createState(challengeIds, {
    completedChallenges: { 'sequencing-1': true },
    pointsByChallenge: { 'sequencing-1': 250 },
    hintReveals: { 'sequencing-2': 99 }
  });
  assert.equal(restored.completedChallenges['sequencing-1'], true);
  assert.equal(Learning.scoreTotal(restored), 0);
  assert.equal(restored.hintReveals['sequencing-2'], Learning.MAX_HINTS);
});

test('progresso e metas refletem apenas conclusões registradas', () => {
  const state = Learning.createState(challengeIds);
  const challenge = Missions.CHALLENGES['sequencing-1'];
  Learning.awardCompletion(state, challenge, validResult(challenge), { valid: true }, 12, foundations);
  let summary = Learning.progress(state, foundations);
  assert.equal(summary.completed, 1);
  assert.equal(summary.total, 6);
  assert.equal(summary.currentFoundation, 'Sequenciamento');
  assert.deepEqual(summary.achievements.map((achievement) => achievement.id), ['first-challenge']);
  assert.ok(state.history.some((event) => event.type === 'achievement-unlocked' && event.achievementId === 'first-challenge'));
});

test('estado serializado preserva progresso e não contém dados pessoais', () => {
  const state = Learning.createState(challengeIds);
  const stored = Learning.toStorage(state);
  assert.deepEqual(Object.keys(stored).sort(), [
    'achievements', 'completedChallenges', 'hintReveals', 'history', 'pointsByChallenge', 'version'
  ]);
  assert.equal(JSON.stringify(stored).includes('name'), false);
  assert.equal(JSON.stringify(stored).includes('age'), false);
});
