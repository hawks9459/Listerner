const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRobotState,
  moveRobot,
  turnRobot,
  missionReached,
  resetMissionState,
  validateSequence,
  normalizeDirection,
  createMissionState,
  executeSequence,
  canMoveTo,
  conditionValue,
  stopMission
} = require('./listener-engine.js');

const grid = [
  '#####',
  '#...#',
  '#.#.#',
  '#...#',
  '#####'
];

test('posições válidas seguem a direção atual', () => {
  const robot = createRobotState({ x: 1, y: 1, dir: 90 });
  const result = moveRobot(robot, grid);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { x: 2, y: 1, dir: 90 });
});

test('uma posição fora do mapa ou marcada como edifício não é permitida', () => {
  assert.equal(canMoveTo(grid, 1, 1), true);
  assert.equal(canMoveTo(grid, -1, 1), false);
  assert.equal(canMoveTo(grid, 2, 2), false);
});

test('colisões em parede bloqueiam o avanço', () => {
  const robot = createRobotState({ x: 3, y: 1, dir: 90 });
  const result = moveRobot(robot, grid);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'blocked');
  assert.deepEqual(result.state, { x: 3, y: 1, dir: 90 });
});

test('giros de 90 graus atualizam a orientação', () => {
  const robot = createRobotState({ x: 1, y: 2, dir: 0 });
  const result = turnRobot(robot, 90);

  assert.equal(result.ok, true);
  assert.equal(result.state.dir, 90);
});

test('avançar respeita a orientação depois de um giro', () => {
  const robot = createRobotState({ x: 1, y: 1, dir: 0 });
  const turned = turnRobot(robot, 90);
  const moved = moveRobot(turned.state, grid);

  assert.equal(moved.ok, true);
  assert.deepEqual(moved.state, { x: 2, y: 1, dir: 90 });
});

test('giro à esquerda segue a convenção 0 norte, 90 leste e aumenta no sentido horário', () => {
  const robot = createRobotState({ x: 3, y: 1, dir: 0 });
  const turned = turnRobot(robot, -90);
  const moved = moveRobot(turned.state, grid);

  assert.equal(turned.state.dir, 270);
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.state, { x: 2, y: 1, dir: 270 });
});

test('reinicialização restaura posição, orientação e estado transitório', () => {
  const reset = resetMissionState({
    start: { x: 1, y: 1, dir: 180 },
    robot: { x: 3, y: 3, dir: 90 },
    execution: { running: true, result: 'complete', blocked: true },
    score: 12
  });

  assert.deepEqual(reset.robot, { x: 1, y: 1, dir: 180 });
  assert.deepEqual(reset.execution, {
    running: false, result: null, blocked: false, reason: null, instructionsExecuted: 0
  });
  assert.equal(reset.score, 12);
});

test('orientação normaliza ângulos fora do intervalo', () => {
  assert.equal(normalizeDirection(450), 90);
  assert.equal(normalizeDirection(-90), 270);
});

test('chegada ao destino identifica sucesso', () => {
  const robot = createRobotState({ x: 3, y: 3, dir: 180 });
  const target = { x: 3, y: 3 };

  assert.equal(missionReached(robot, target), true);
});

test('sequência inválida com muitas instruções é rejeitada', () => {
  const sequence = Array.from({ length: 41 }, () => ({ type: 'move' }));
  const result = validateSequence(sequence, 40);

  assert.equal(result.valid, false);
  assert.match(result.reason, /limite/i);
});

test('permissões da etapa rejeitam estruturas ainda não liberadas', () => {
  const sequencingPermissions = { allowRepeat: false, allowConditionals: false };
  const repetitionPermissions = { allowRepeat: true, allowConditionals: false };

  assert.equal(validateSequence([{ type: 'repeat', times: 2, children: [{ type: 'forward' }] }], 40, sequencingPermissions).valid, false);
  assert.equal(validateSequence([{ type: 'if', condition: 'pathClear', then: [], else: [] }], 40, sequencingPermissions).valid, false);
  assert.equal(validateSequence([{ type: 'repeat', times: 2, children: [{ type: 'forward' }] }], 40, repetitionPermissions).valid, true);
  assert.equal(validateSequence([{ type: 'if', condition: 'pathClear', then: [], else: [] }], 40, repetitionPermissions).valid, false);
  assert.equal(validateSequence([{ type: 'if', condition: 'pathClear', then: [], else: [] }], 40, {
    allowRepeat: true,
    allowConditionals: true
  }).valid, false);
  assert.equal(validateSequence([{ type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [] }], 40, {
    allowConditionals: true
  }).valid, true);
  assert.equal(validateSequence([{ type: 'if', condition: 'pathBlocked', then: [{ type: 'forward' }], else: [] }], 40, {
    allowConditionals: true
  }).valid, false);
  assert.equal(validateSequence([{ type: 'if', condition: 'atTarget', then: [{ type: 'forward' }], else: [] }], 40, {
    allowConditionals: true
  }).valid, false);
  assert.equal(validateSequence([{ type: 'if', condition: 'pathClear', then: [{ type: 'forward' }] }], 40, {
    allowConditionals: true
  }).valid, false);
  assert.equal(validateSequence([{ type: 'repeat', times: 2, children: [] }], 40, {
    allowRepeat: true
  }).valid, false);
  assert.equal(validateSequence([{ type: 'repeat', times: 2, children: [{ type: 'forward' }] }]).valid, false);
  assert.equal(validateSequence([{ type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [] }]).valid, false);
});

test('motor não executa comandos estruturais sem permissão da etapa', async () => {
  const mission = createMissionState({
    grid: ['...'],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 2, y: 0 }
  });
  const result = await executeSequence(mission, [
    { type: 'repeat', times: 2, children: [{ type: 'forward' }] }
  ], { permissions: { allowRepeat: false, allowConditionals: false } });

  assert.equal(result.result, 'invalid');
  assert.equal(mission.robot.x, 0);
  assert.equal(mission.execution.instructionsExecuted, 0);

  const missionWithoutPermissions = createMissionState({
    grid: ['...'],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 2, y: 0 }
  });
  const resultWithoutPermissions = await executeSequence(missionWithoutPermissions, [
    { type: 'repeat', times: 2, children: [{ type: 'forward' }] }
  ]);
  assert.equal(resultWithoutPermissions.result, 'invalid');
  assert.equal(missionWithoutPermissions.robot.x, 0);
});

test('avanço longo respeita o limite de instruções durante a validação', () => {
  const result = validateSequence(Array.from({ length: 14 }, () => ({ type: 'forward_long' })), 40);
  assert.equal(result.valid, false);
  assert.match(result.reason, /limite/i);
  assert.equal(validateSequence([{ type: 'repeat', times: 11, children: [{ type: 'forward' }] }], 40, {
    allowRepeat: true
  }).valid, false);
});

test('motor executa repetição, condição, giro e chegada sem depender de pixels', async () => {
  const mission = createMissionState({
    grid: [
      ['#', '#', '#', '#', '#'],
      ['#', '.', '.', '.', '#'],
      ['#', '.', '#', '.', '#'],
      ['#', '.', '.', '.', '#'],
      ['#', '#', '#', '#', '#']
    ],
    start: { x: 1, y: 1, dir: 90 },
    target: { x: 3, y: 1 }
  });
  const result = await executeSequence(mission, [
    { type: 'repeat', times: 2, children: [{ type: 'forward' }] },
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90R' }] }
  ], { permissions: { allowRepeat: true, allowConditionals: true } });

  assert.equal(result.result, 'complete');
  assert.equal(result.reached, true);
  assert.deepEqual(mission.robot, { x: 3, y: 1, dir: 180 });
});

test('motor detém movimento bloqueado e identifica o motivo', async () => {
  const mission = createMissionState({
    grid: ['#####', '#...#', '#.#.#', '#...#', '#####'],
    start: { x: 3, y: 1, dir: 90 },
    target: { x: 1, y: 1 }
  });
  const result = await executeSequence(mission, [{ type: 'forward' }]);

  assert.equal(result.result, 'blocked');
  assert.equal(mission.execution.blocked, true);
  assert.deepEqual(mission.robot, { x: 3, y: 1, dir: 90 });
});

test('motor respeita conexões explícitas entre posições', async () => {
  const mission = createMissionState({
    grid: [['.', '.']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 1, y: 0 },
    connections: new Set()
  });
  const result = await executeSequence(mission, [{ type: 'forward' }]);

  assert.equal(result.result, 'blocked');
  assert.deepEqual(mission.robot, { x: 0, y: 0, dir: 90 });
});

test('parada interrompe a execução sem alterar a regra lógica de movimento', async () => {
  const mission = createMissionState({
    grid: [['.', '.']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 1, y: 0 }
  });
  let releaseTransition;
  const transition = new Promise((resolve) => { releaseTransition = resolve; });
  const run = executeSequence(mission, [{ type: 'forward' }], { onTransition: () => transition });

  assert.equal(stopMission(mission), true);
  releaseTransition();
  const result = await run;

  assert.equal(result.result, 'stopped');
  assert.deepEqual(mission.robot, { x: 1, y: 0, dir: 90 });
});

test('condicional executa a ramificação correta diante de uma posição bloqueada', async () => {
  const mission = createMissionState({
    grid: [['.', '#'], ['.', '.']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 1, y: 1 }
  });
  const result = await executeSequence(mission, [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90R' }] },
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'forward' }
  ], { permissions: { allowRepeat: true, allowConditionals: true } });

  assert.equal(result.result, 'complete');
  assert.equal(result.trace[0].value, false);
  assert.equal(result.trace[0].branch, 'else');
  assert.deepEqual(mission.robot, { x: 1, y: 1, dir: 90 });
});

test('pathClear é avaliado a cada decisão e registra posição e ramo executado', async () => {
  const mission = createMissionState({
    grid: [['.', '#'], ['.', '.']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 1, y: 1 }
  });
  assert.equal(conditionValue('pathClear', mission), false);
  const result = await executeSequence(mission, [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90R' }] },
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90R' }] }
  ], { permissions: { allowRepeat: true, allowConditionals: true } });
  assert.equal(result.result, 'complete');
  assert.deepEqual(result.trace.filter((event) => event.kind === 'condition').map((event) => ({
    value: event.value, branch: event.branch, at: event.at
  })), [
    { value: false, branch: 'else', at: { x: 0, y: 0 } },
    { value: true, branch: 'then', at: { x: 0, y: 1 } },
    { value: false, branch: 'else', at: { x: 1, y: 1 } }
  ]);
});

test('condicional reavalia caminho livre após avançar até a posição bloqueada', async () => {
  const mission = createMissionState({
    grid: [['.', '.', '.', '#']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 2, y: 0 }
  });
  const result = await executeSequence(mission, [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [] }
  ], { permissions: { allowRepeat: true, allowConditionals: true } });

  assert.equal(result.result, 'complete');
  assert.deepEqual(mission.robot, { x: 2, y: 0, dir: 90 });
  assert.deepEqual(result.trace.filter((event) => event.kind === 'condition').map((event) => ({
    at: event.at, value: event.value, branch: event.branch
  })), [
    { at: { x: 0, y: 0 }, value: true, branch: 'then' },
    { at: { x: 1, y: 0 }, value: true, branch: 'then' },
    { at: { x: 2, y: 0 }, value: false, branch: 'else' }
  ]);
});

test('repetição pode ser executada dentro do ramo Então de uma condicional', async () => {
  const mission = createMissionState({
    grid: [['.', '.', '#']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 1, y: 0 }
  });
  const result = await executeSequence(mission, [{
    type: 'if',
    condition: 'pathClear',
    then: [{ type: 'repeat', times: 1, children: [{ type: 'forward' }] }],
    else: [{ type: 'turn90R' }]
  }], { permissions: { allowRepeat: true, allowConditionals: true } });

  assert.equal(result.result, 'complete');
  assert.equal(result.reached, true);
  assert.deepEqual(mission.robot, { x: 1, y: 0, dir: 180 });
  assert.deepEqual(result.trace.filter((event) => event.kind === 'condition').map((event) => event.value), [true, false]);
  assert.equal(result.trace.some((event) => event.kind === 'command' && event.repeatPath.length === 1), true);
});

test('condicional sem progresso é contido pelo limite de instruções', async () => {
  const mission = createMissionState({
    grid: [['.', '.']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 1, y: 0 }
  });
  const result = await executeSequence(mission, [{
    type: 'if',
    condition: 'pathClear',
    then: [{
      type: 'repeat',
      times: 2,
      children: [{ type: 'turn90L' }, { type: 'turn90R' }]
    }],
    else: []
  }], { maxInstructions: 5, permissions: { allowRepeat: true, allowConditionals: true } });

  assert.equal(result.result, 'invalid');
  assert.match(result.reason, /limite de instruções/i);
  assert.ok(mission.execution.instructionsExecuted <= 6);
});

test('sequência incompleta não marca sucesso mesmo sem colisão', async () => {
  const mission = createMissionState({
    grid: [['.', '.', '.']],
    start: { x: 0, y: 0, dir: 90 },
    target: { x: 2, y: 0 }
  });
  const result = await executeSequence(mission, [{ type: 'forward' }]);

  assert.equal(result.result, 'incomplete');
  assert.equal(result.reached, false);
  assert.equal(mission.execution.blocked, false);
});
