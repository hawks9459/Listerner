const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('./listener-engine.js');
const Missions = require('./listener-missions.js');

const solutions = {
  'sequencing-1': [
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'forward' }
  ],
  'sequencing-2': [
    { type: 'forward' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'forward' }
  ],
  'repetition-1': [
    { type: 'repeat', times: 2, children: [{ type: 'forward' }] },
    { type: 'turn90R' },
    { type: 'forward' }
  ],
  'repetition-2': [
    { type: 'turn90R' },
    { type: 'repeat', times: 6, children: [{ type: 'forward' }] },
    { type: 'turn90L' },
    { type: 'repeat', times: 4, children: [{ type: 'forward' }] },
    { type: 'turn90L' },
    { type: 'repeat', times: 3, children: [{ type: 'forward' }] },
    { type: 'turn90L' },
    { type: 'forward' }
  ],
  'conditionals-1': [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90L' }] },
    { type: 'forward' }
  ],
  'conditionals-2': [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90L' }] },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90R' },
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90R' }] },
    { type: 'repeat', times: 4, children: [{ type: 'forward' }] },
    { type: 'turn90L' },
    { type: 'repeat', times: 3, children: [{ type: 'forward' }] },
    { type: 'turn90L' },
    { type: 'repeat', times: 3, children: [{ type: 'forward' }] }
  ]
};

function permissionsFor(challenge) {
  return {
    allowRepeat: challenge.foundation !== 'sequencing',
    allowConditionals: challenge.foundation === 'conditionals'
  };
}

async function execute(challengeId, program) {
  const challenge = Missions.CHALLENGES[challengeId];
  const grid = Missions.makeGrid(challenge);
  const state = Engine.createMissionState({
    grid,
    start: challenge.start,
    target: challenge.destination.position,
    connections: Missions.makeConnections(grid),
    blockedValues: ['building', 'blocked']
  });
  const result = await Engine.executeSequence(state, program, { permissions: permissionsFor(challenge) });
  return { challenge, state, result, pedagogy: Missions.validatePedagogy(challengeId, program, result) };
}

function shortestDistance(grid, start, target, connections) {
  const queue = [{ ...start, distance: 0 }];
  const visited = new Set([Missions.positionKey(start)]);
  while (queue.length) {
    const current = queue.shift();
    if (current.x === target.x && current.y === target.y) return current.distance;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const edge = [Missions.positionKey(current), Missions.positionKey(next)].sort().join('|');
      const key = Missions.positionKey(next);
      if (!visited.has(key) && connections.has(edge) &&
          Engine.canMoveTo(grid, next.x, next.y, { blockedValues: ['building', 'blocked'] })) {
        visited.add(key);
        queue.push({ ...next, distance: current.distance + 1 });
      }
    }
  }
  return -1;
}

test('catálogo contém exatamente seis desafios em ordem de fundamento', () => {
  assert.deepEqual(Object.keys(Missions.CHALLENGES), [
    'sequencing-1', 'sequencing-2',
    'repetition-1', 'repetition-2',
    'conditionals-1', 'conditionals-2'
  ]);
  assert.deepEqual(Object.values(Missions.CHALLENGES).map((challenge) => challenge.number), [1, 2, 3, 4, 5, 6]);
});

test('cada desafio define objetivo, cenário, orientação, comandos, condições e conclusão', () => {
  Object.values(Missions.CHALLENGES).forEach((challenge) => {
    assert.ok(challenge.learningObjective, `${challenge.id}: objetivo ausente`);
    assert.equal(challenge.scenario.mapId, 'listener-city-grid-7x5');
    assert.equal(challenge.scenario.width, Missions.COLS);
    assert.equal(challenge.scenario.height, Missions.ROWS);
    assert.equal(challenge.scenario.obstaclePositions, challenge.obstacles);
    assert.ok([0, 90, 180, 270].includes(challenge.start.dir));
    assert.ok(challenge.allowedCommands.includes('forward'));
    assert.ok(challenge.allowedCommands.includes('repeat'));
    assert.ok(challenge.allowedCommands.includes('if'));
    assert.equal(challenge.completionCriteria.type, 'exact-destination');
    assert.equal(challenge.completionCriteria.destinationId, challenge.destinationId);
    assert.equal(challenge.completionCriteria.requiredStructure, challenge.foundation === 'sequencing' ? 'sequence'
      : challenge.foundation === 'repetition' ? 'repeat' : 'if');
    assert.ok(challenge.errorFeedback);
    assert.deepEqual(challenge.observableConditions, ['pathClear']);
  });
});

test('cada desafio oferece três dicas progressivas adaptadas aos dois perfis', () => {
  Object.values(Missions.CHALLENGES).forEach((challenge) => {
    for (const profile of ['young', 'mature']) {
      assert.equal(challenge.hints[profile].length, 3, `${challenge.id}: quantidade de dicas para ${profile}`);
      assert.ok(challenge.hints[profile].every((hint) => typeof hint === 'string' && hint.length > 0));
    }
  });
});

test('cada desafio inicia e termina em uma posição transitável conectada', () => {
  Object.values(Missions.CHALLENGES).forEach((challenge) => {
    const grid = Missions.makeGrid(challenge);
    const target = challenge.destination.position;
    assert.equal(Engine.canMoveTo(grid, challenge.start.x, challenge.start.y, { blockedValues: ['building', 'blocked'] }), true);
    assert.equal(Engine.canMoveTo(grid, target.x, target.y, { blockedValues: ['building', 'blocked'] }), true);
    assert.ok(shortestDistance(grid, challenge.start, target, Missions.makeConnections(grid)) >= 0, challenge.id);
    assert.equal(challenge.destinationId, challenge.destination.id);
  });
});

test('o segundo desafio de cada fundamento possui pelo menos dois obstáculos em ruas bloqueadas', () => {
  ['sequencing-2', 'repetition-2', 'conditionals-2'].forEach((challengeId) => {
    const challenge = Missions.CHALLENGES[challengeId];
    const grid = Missions.makeGrid(challenge);
    assert.ok(challenge.obstacles.length >= 2, challengeId);
    challenge.obstacles.forEach(({ x, y }) => {
      assert.equal(Missions.isRoad(x, y), true, `${challengeId}: obstáculo está fora da rua`);
      assert.equal(grid[y][x], 'blocked', `${challengeId}: obstáculo não bloqueia a posição`);
      const connections = Missions.makeConnections(grid);
      const roadNeighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .filter(([neighborX, neighborY]) =>
          neighborX >= 0 && neighborY >= 0 &&
          neighborX < Missions.COLS && neighborY < Missions.ROWS &&
          Missions.isRoad(neighborX, neighborY));
      assert.ok(roadNeighbors.length > 0, `${challengeId}: o obstáculo precisa estar conectado à rua`);
      roadNeighbors.forEach(([neighborX, neighborY]) => {
        const edge = [Missions.positionKey({ x, y }), Missions.positionKey({ x: neighborX, y: neighborY })].sort().join('|');
        assert.ok(connections.has(edge), `${challengeId}: a rua visual deve continuar sob o obstáculo`);
      });
      assert.notDeepEqual({ x, y }, challenge.start, `${challengeId}: obstáculo cobre a largada`);
      assert.notDeepEqual({ x, y }, challenge.destination.position, `${challengeId}: obstáculo cobre o destino`);
    });
  });
});

test('os dois obstáculos de cada segundo desafio alteram as rotas válidas', () => {
  ['sequencing-2', 'repetition-2'].forEach((challengeId) => {
    const challenge = Missions.CHALLENGES[challengeId];
    const fullGrid = Missions.makeGrid(challenge);
    const fullDistance = shortestDistance(fullGrid, challenge.start, challenge.destination.position, Missions.makeConnections(fullGrid));
    challenge.obstacles.forEach((_, removedIndex) => {
      const remainingObstacles = challenge.obstacles.filter((__, index) => index !== removedIndex);
      const alternateGrid = Missions.makeGrid({ ...challenge, obstacles: remainingObstacles });
      const alternateDistance = shortestDistance(alternateGrid, challenge.start, challenge.destination.position, Missions.makeConnections(alternateGrid));
      assert.ok(alternateDistance < fullDistance, `${challengeId}: remover um obstáculo deve alterar a rota`);
    });
  });
});

for (const [challengeId, program] of Object.entries(solutions)) {
  test(`${challengeId}: solução de referência executada pelo motor atende o critério pedagógico`, async () => {
    const outcome = await execute(challengeId, program);
    assert.equal(outcome.result.result, 'complete');
    assert.equal(outcome.result.reached, true);
    assert.equal(outcome.state.robot.x, outcome.challenge.destination.position.x);
    assert.equal(outcome.state.robot.y, outcome.challenge.destination.position.y);
    assert.ok([0, 90, 180, 270].includes(outcome.state.robot.dir));
    assert.equal(outcome.pedagogy.valid, true, outcome.pedagogy.reason);
  });
}

test('sequenciamento aceita comandos equivalentes que preservam a ordem e o percurso', async () => {
  const outcome = await execute('sequencing-1', [
    { type: 'move' },
    { type: 'move' },
    { type: 'turnLeft' },
    { type: 'move' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
});

test('repetição aceita o alias de movimento dentro de um bloco funcional', async () => {
  const outcome = await execute('repetition-1', [
    { type: 'repeat', times: 2, children: [{ type: 'move' }] },
    { type: 'turnRight' },
    { type: 'move' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
});

test('condicionais aceita a condição como ciclo até encontrar bloqueio', async () => {
  const outcome = await execute('conditionals-1', [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90L' }] },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
  assert.deepEqual(outcome.result.trace.filter((event) => event.kind === 'condition').map((event) => ({
    at: event.at, value: event.value, branch: event.branch
  })), [
    { at: { x: 0, y: 2 }, value: true, branch: 'then' },
    { at: { x: 1, y: 2 }, value: true, branch: 'then' },
    { at: { x: 2, y: 2 }, value: true, branch: 'then' },
    { at: { x: 3, y: 2 }, value: false, branch: 'else' }
  ]);
});

test('condicionais avançado reutiliza pathClear em posições com resultados diferentes', async () => {
  const outcome = await execute('conditionals-2', solutions['conditionals-2']);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
  assert.deepEqual(outcome.result.trace.filter((event) => event.kind === 'condition').filter((event) =>
    event.at.x === 0 && event.at.y === 2 ||
    event.at.x === 3 && event.at.y === 2 ||
    event.at.x === 3 && event.at.y === 0
  ).map((event) => ({ at: event.at, value: event.value })), [
    { at: { x: 0, y: 2 }, value: true },
    { at: { x: 3, y: 2 }, value: false },
    { at: { x: 3, y: 0 }, value: false }
  ]);
});

test('sequenciamento rejeita uma ordem de comandos que não completa o percurso', async () => {
  const outcome = await execute('sequencing-1', [
    { type: 'forward' },
    { type: 'turn90L' },
    { type: 'forward' }
  ]);
  assert.notEqual(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, false);
});

test('repetição exige o bloco funcional mesmo quando os comandos simples chegam ao destino', async () => {
  const outcome = await execute('repetition-1', [
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90R' },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, false);
});

test('repetição avançada aceita uma única estrutura funcional de repetição', async () => {
  const outcome = await execute('repetition-2', [
    { type: 'repeat', times: 2, children: [{ type: 'turn90R' }] },
    { type: 'turn90L' },
    ...Array.from({ length: 6 }, () => ({ type: 'forward' })),
    { type: 'turn90L' },
    ...Array.from({ length: 4 }, () => ({ type: 'forward' })),
    { type: 'turn90L' },
    ...Array.from({ length: 3 }, () => ({ type: 'forward' })),
    { type: 'turn90L' },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
});

test('condicionais rejeita um desvio fixo sem decisões avaliadas', async () => {
  const outcome = await execute('conditionals-1', [
    { type: 'turn90L' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90R' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90R' },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, false);
});

test('condicionais rejeita uma decisão que não contribui para o desvio', async () => {
  const outcome = await execute('conditionals-1', [
    { type: 'if', condition: 'pathClear', then: [], else: [{ type: 'turn90L' }] },
    { type: 'turn90L' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90R' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90R' },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'invalid');
  assert.equal(outcome.pedagogy.valid, false);
});

test('condicionais aceita repetição aninhada dentro do ramo avaliado', async () => {
  const outcome = await execute('conditionals-1', [
    {
      type: 'if', condition: 'pathClear',
      then: [{ type: 'repeat', times: 1, children: [{ type: 'forward' }] }],
      else: [{ type: 'turn90L' }]
    },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
});

test('sequenciamento rejeita condições ainda não liberadas mesmo em caminho alternativo', async () => {
  const outcome = await execute('sequencing-1', [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90L' }] },
    { type: 'turn90L' },
    { type: 'forward' },
    { type: 'forward' },
    { type: 'turn90R' },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'invalid');
  assert.match(outcome.result.reason, /ainda não foi liberado/i);
  assert.equal(outcome.result.state.robot.x, outcome.challenge.start.x);
  assert.equal(outcome.result.state.robot.y, outcome.challenge.start.y);
});

test('repetição aceita um desvio mais longo sem exigir o trajeto de referência', async () => {
  const outcome = await execute('repetition-1', [
    { type: 'turn90R' },
    { type: 'repeat', times: 3, children: [{ type: 'forward' }] },
    { type: 'turn90L' },
    { type: 'repeat', times: 2, children: [{ type: 'forward' }] },
    { type: 'turn90L' },
    { type: 'repeat', times: 2, children: [{ type: 'forward' }] },
    { type: 'turn90L' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
});

test('condicionais aceita rota e posições de decisão diferentes da solução de referência', async () => {
  const outcome = await execute('conditionals-1', [
    { type: 'turn90L' },
    {
      type: 'if', condition: 'pathClear',
      then: [{ type: 'forward' }],
      else: [{ type: 'turn90R' }]
    },
    { type: 'repeat', times: 3, children: [{ type: 'forward' }] },
    { type: 'turn90R' },
    { type: 'forward' }
  ]);
  assert.equal(outcome.result.result, 'complete');
  assert.equal(outcome.pedagogy.valid, true);
  assert.deepEqual(outcome.result.trace.filter((event) => event.kind === 'condition').map(({ at, value }) => ({ at, value })), [
    { at: { x: 0, y: 2 }, value: true },
    { at: { x: 0, y: 1 }, value: true },
    { at: { x: 0, y: 0 }, value: false }
  ]);
});

test('condicionais rejeita decisões registradas com ramos inconsistentes com pathClear', async () => {
  const outcome = await execute('conditionals-1', solutions['conditionals-1']);
  outcome.result.trace.filter((event) => event.kind === 'condition').forEach((event) => {
    event.branch = event.value ? 'else' : 'then';
  });
  assert.equal(Missions.validatePedagogy('conditionals-1', solutions['conditionals-1'], outcome.result).valid, false);
});

test('a validação pedagógica exige que a posição final seja a entrada exata', async () => {
  const outcome = await execute('sequencing-1', solutions['sequencing-1']);
  outcome.result.state.robot.x = 2;
  assert.equal(Missions.validatePedagogy('sequencing-1', solutions['sequencing-1'], outcome.result).valid, false);
});

test('condição caminho livre consulta a conectividade e os obstáculos do mapa', async () => {
  const challenge = Missions.CHALLENGES['conditionals-1'];
  const grid = Missions.makeGrid(challenge);
  const state = Engine.createMissionState({
    grid,
    start: challenge.start,
    target: challenge.destination.position,
    connections: Missions.makeConnections(grid),
    blockedValues: ['building', 'blocked']
  });
  const result = await Engine.executeSequence(state, [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90L' }] }
  ], { permissions: permissionsFor(challenge) });
  assert.equal(result.trace[0].kind, 'condition');
  assert.equal(result.trace[0].value, true);
  assert.equal(result.trace[0].branch, 'then');
  assert.equal(result.trace[0].at.x, 0);
  assert.equal(result.trace[0].at.y, 2);
});

test('condicionais usa pathClear para ramificar diante de um bloqueio real', async () => {
  const challenge = Missions.CHALLENGES['conditionals-1'];
  const state = Engine.createMissionState({
    grid: Missions.makeGrid(challenge),
    start: { x: 3, y: 2, dir: 90 },
    target: challenge.destination.position,
    connections: Missions.makeConnections(Missions.makeGrid(challenge)),
    blockedValues: ['building', 'blocked']
  });
  const result = await Engine.executeSequence(state, [
    { type: 'if', condition: 'pathClear', then: [{ type: 'forward' }], else: [{ type: 'turn90L' }] },
    { type: 'forward' }
  ], { permissions: permissionsFor(challenge) });
  assert.equal(result.trace[0].value, false);
  assert.equal(result.trace[0].branch, 'else');
  assert.equal(state.robot.x, 3);
  assert.equal(state.robot.y, 1);
});

test('as conexões visuais incluem pavimento sob obstáculos, mas o motor ainda bloqueia a entrada', async () => {
  const challenge = Missions.CHALLENGES['conditionals-1'];
  const grid = Missions.makeGrid(challenge);
  const connections = Missions.makeConnections(grid);
  const obstacle = challenge.obstacles[0];
  const edge = [Missions.positionKey({ x: obstacle.x - 1, y: obstacle.y }), Missions.positionKey(obstacle)].sort().join('|');
  assert.equal(Missions.isRoad(obstacle.x, obstacle.y), true);
  assert.ok(connections.has(edge));
  const state = Engine.createMissionState({
    grid,
    start: { x: obstacle.x - 1, y: obstacle.y, dir: 90 },
    target: challenge.destination.position,
    connections,
    blockedValues: ['building', 'blocked']
  });
  const result = await Engine.executeSequence(state, [{ type: 'forward' }]);
  assert.equal(result.result, 'blocked');
  assert.equal(state.robot.x, obstacle.x - 1);
});

test('alcançar uma posição próxima não valida o destino nominal', async () => {
  const challenge = Missions.CHALLENGES['sequencing-1'];
  const grid = Missions.makeGrid(challenge);
  const state = Engine.createMissionState({
    grid,
    start: challenge.start,
    target: challenge.destination.position,
    connections: Missions.makeConnections(grid),
    blockedValues: ['building', 'blocked']
  });
  const result = await Engine.executeSequence(state, [
    { type: 'forward' },
    { type: 'forward' }
  ]);
  assert.equal(result.result, 'incomplete');
  assert.equal(result.reached, false);
  assert.equal(Missions.validatePedagogy('sequencing-1', [
    { type: 'forward' }, { type: 'forward' }
  ], result).valid, false);
});
