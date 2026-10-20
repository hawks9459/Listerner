(function (global) {
  'use strict';

  const COLS = 7;
  const ROWS = 5;
  const ROAD_ROWS = Object.freeze([0, 2, 4]);
  const ROAD_COLUMNS = Object.freeze([0, 3, 6]);
  const MAP_ID = 'listener-city-grid-7x5';

  const LANDMARKS = Object.freeze({
    hospital: Object.freeze({
      id: 'hospital-entrance', name: 'Hospital', kind: 'hospital',
      arrival: 'à entrada do Hospital',
      position: Object.freeze({ x: 3, y: 1 }), lot: Object.freeze({ x: 2, y: 1 }),
      entrance: 'east', colors: Object.freeze({ front: '#eee7d8', side: '#c7b59c', roof: '#cb070b' })
    }),
    school: Object.freeze({
      id: 'school-entrance', name: 'Escola', kind: 'school',
      arrival: 'à entrada da Escola',
      position: Object.freeze({ x: 4, y: 2 }), lot: Object.freeze({ x: 4, y: 1 }),
      entrance: 'south', colors: Object.freeze({ front: '#e6c56e', side: '#b9864b', roof: '#cb070b' })
    }),
    market: Object.freeze({
      id: 'market-entrance', name: 'Mercado', kind: 'market',
      arrival: 'à entrada do Mercado',
      position: Object.freeze({ x: 1, y: 2 }), lot: Object.freeze({ x: 1, y: 3 }),
      entrance: 'north', colors: Object.freeze({ front: '#d6dfbd', side: '#90a17b', roof: '#648a54' })
    }),
    plaza: Object.freeze({
      id: 'plaza-entrance', name: 'Praça', kind: 'park',
      arrival: 'à entrada da Praça',
      position: Object.freeze({ x: 3, y: 3 }), lot: Object.freeze({ x: 4, y: 3 }),
      entrance: 'west'
    }),
    eastHome: Object.freeze({
      id: 'east-home-entrance', name: 'Casa da Rua Leste', kind: 'house',
      arrival: 'à casa da Rua Leste',
      position: Object.freeze({ x: 6, y: 1 }), lot: Object.freeze({ x: 5, y: 1 }),
      entrance: 'east', colors: Object.freeze({ front: '#e6dfc9', side: '#a89b7b', roof: '#cb070b' })
    })
  });

  function defineChallenge(challenge) {
    const obstacles = Object.freeze(challenge.obstacles);
    const allowedCommands = ['forward', 'turn90L', 'turn90R', 'repeat', 'if'];
    return Object.freeze({
      ...challenge,
      obstacles,
      allowedCommands: Object.freeze(allowedCommands),
      observableConditions: Object.freeze(['pathClear']),
      scenario: Object.freeze({
        mapId: MAP_ID,
        width: COLS,
        height: ROWS,
        obstaclePositions: obstacles
      }),
      completionCriteria: Object.freeze({
        type: 'exact-destination',
        destinationId: challenge.destinationId,
        requiredStructure: challenge.foundation === 'repetition' ? 'repeat'
          : challenge.foundation === 'conditionals' ? 'if'
            : 'sequence'
      }),
      errorFeedback: challenge.criteria.feedback
    });
  }

  const CHALLENGES = Object.freeze({
    'sequencing-1': defineChallenge({
      id: 'sequencing-1', number: 1, foundation: 'sequencing', concept: 'Sequenciamento',
      title: 'Leve a compra ao mercado',
      description: 'Organize os passos e a virada para chegar à entrada do Mercado.',
      learningObjective: 'Ordenar avanços e um giro para seguir um percurso curto.',
      hints: Object.freeze({
        young: Object.freeze(['Olhe a rua que leva ao Mercado.', 'Primeiro use passos e depois um giro.', 'O Listener começa indo para o sul; a entrada fica na rua do Mercado.']),
        mature: Object.freeze(['Observe a posição inicial, a orientação e a entrada do Mercado.', 'Este percurso trabalha Sequenciamento: a ordem das ações importa.', 'A rota exige avançar antes e depois de mudar para a rua vertical.'])
      }),
      start: Object.freeze({ x: 0, y: 0, dir: 180 }), destinationId: 'market-entrance',
      destination: LANDMARKS.market,
      obstacles: Object.freeze([]),
      criteria: Object.freeze({
        feedback: 'Organize os comandos em sequência, use os blocos necessários e chegue à entrada do Mercado.'
      })
    }),
    'sequencing-2': defineChallenge({
      id: 'sequencing-2', number: 2, foundation: 'sequencing', concept: 'Sequenciamento',
      title: 'Encontre a entrada da escola',
      description: 'Obras fecham os atalhos. Organize os passos até a entrada da Escola.',
      learningObjective: 'Planejar uma rota mais longa, ordenar giros e contornar ruas bloqueadas.',
      hints: Object.freeze({
        young: Object.freeze(['Veja onde estão as obras antes de escolher uma rua.', 'Neste desafio, planeje os passos e os giros na ordem que preferir.', 'Experimente ruas diferentes e ajuste os comandos até chegar à Escola.']),
        mature: Object.freeze(['Trace uma rota possível pelas ruas conectadas.', 'O objetivo é praticar Sequenciamento; outros blocos também podem ajudar.', 'Há mais de um caminho: teste uma ordem de comandos que contorne as obras.'])
      }),
      start: Object.freeze({ x: 3, y: 4, dir: 90 }), destinationId: 'school-entrance',
      destination: LANDMARKS.school,
      obstacles: Object.freeze([
        Object.freeze({ x: 3, y: 3 }),
        Object.freeze({ x: 2, y: 2 }),
        Object.freeze({ x: 5, y: 2 })
      ]),
      criteria: Object.freeze({
        feedback: 'Organize os comandos em sequência, combine os blocos que preferir e chegue à entrada da Escola.'
      })
    }),
    'repetition-1': defineChallenge({
      id: 'repetition-1', number: 3, foundation: 'repetition', concept: 'Repetição',
      title: 'Siga a rua até o Mercado',
      description: 'Agrupe os avanços iguais em uma repetição para chegar à entrada do Mercado.',
      learningObjective: 'Usar uma repetição contada para agrupar avanços consecutivos.',
      hints: Object.freeze({
        young: Object.freeze(['Procure ações que podem se repetir no caminho.', 'Use o bloco Repita para agrupar essas ações.', 'Escolha uma rota, repita um trecho e continue até o Mercado.']),
        mature: Object.freeze(['Explore trechos da cidade em que ações se repetem.', 'A Repetição representa várias ações com um bloco contado.', 'Agrupe um trecho da rota que escolher e complete o percurso.'])
      }),
      start: Object.freeze({ x: 0, y: 4, dir: 0 }), destinationId: 'market-entrance',
      destination: LANDMARKS.market,
      obstacles: Object.freeze([]),
      criteria: Object.freeze({
        feedback: 'Para concluir este desafio, use o bloco Repita e chegue à entrada do Mercado.'
      })
    }),
    'repetition-2': defineChallenge({
      id: 'repetition-2', number: 4, foundation: 'repetition', concept: 'Repetição',
      title: 'Atravesse a cidade em padrões',
      description: 'As obras fecham dois atalhos. Agrupe os avanços do contorno até a Praça.',
      learningObjective: 'Combinar repetições contadas para representar trechos de comprimentos diferentes.',
      hints: Object.freeze({
        young: Object.freeze(['Observe as obras e encontre ruas que continuam abertas.', 'Use Repita para agrupar ações no caminho que escolher.', 'Combine os blocos como quiser e siga até a Praça.']),
        mature: Object.freeze(['Compare os trechos possíveis e identifique ações repetidas.', 'O bloco Repita pode ser combinado com outros comandos.', 'Não é preciso copiar uma rota pronta: teste uma combinação que alcance a Praça.'])
      }),
      start: Object.freeze({ x: 6, y: 0, dir: 180 }), destinationId: 'plaza-entrance',
      destination: LANDMARKS.plaza,
      obstacles: Object.freeze([
        Object.freeze({ x: 6, y: 2 }),
        Object.freeze({ x: 3, y: 2 })
      ]),
      criteria: Object.freeze({
        feedback: 'Para concluir este desafio, use o bloco Repita e chegue à entrada da Praça. Você pode combinar outras ações e blocos.'
      })
    }),
    'conditionals-1': defineChallenge({
      id: 'conditionals-1', number: 5, foundation: 'conditionals', concept: 'Condicionais',
      title: 'Desvie da rua fechada',
      description: 'Confira se o caminho está livre e desvie da obra para chegar ao Hospital.',
      learningObjective: 'Reavaliar o caminho após cada avanço e virar quando encontrar uma obra.',
      hints: Object.freeze({
        young: Object.freeze(['Observe o que há à frente do Listener.', 'Use a pergunta “caminho livre?” para decidir uma ação.', 'Se encontrar uma obra, escolha um desvio e continue até o Hospital.']),
        mature: Object.freeze(['Observe como a condição responde ao cenário atual.', 'Use uma Condicional para escolher ações a partir desse resultado.', 'Teste decisões diferentes até chegar ao Hospital sem atravessar obras.'])
      }),
      start: Object.freeze({ x: 0, y: 2, dir: 90 }), destinationId: 'hospital-entrance',
      destination: LANDMARKS.hospital,
      obstacles: Object.freeze([Object.freeze({ x: 4, y: 2 })]),
      criteria: Object.freeze({
        feedback: 'Para concluir este desafio, use o bloco Se para tomar uma decisão e chegue à entrada do Hospital.'
      })
    }),
    'conditionals-2': defineChallenge({
      id: 'conditionals-2', number: 6, foundation: 'conditionals', concept: 'Condicionais',
      title: 'Escolha o caminho até a casa',
      description: 'Use a condição em dois trechos para contornar obras e chegar à casa.',
      learningObjective: 'Reutilizar a mesma condição em dois trechos e escolher desvios diferentes.',
      hints: Object.freeze({
        young: Object.freeze(['Observe as obras e procure ruas abertas.', 'Use “caminho livre?” para escolher entre ações.', 'Você pode combinar blocos e explorar rotas até chegar à casa.']),
        mature: Object.freeze(['Observe os bloqueios e o resultado da condição em cada posição.', 'Reutilize a Condicional; ela consulta o cenário real.', 'Explore diferentes decisões e combinações até chegar à entrada da casa.'])
      }),
      start: Object.freeze({ x: 0, y: 2, dir: 90 }), destinationId: 'east-home-entrance',
      destination: LANDMARKS.eastHome,
      obstacles: Object.freeze([
        Object.freeze({ x: 4, y: 2 }),
        Object.freeze({ x: 4, y: 0 })
      ]),
      criteria: Object.freeze({
        feedback: 'Para concluir este desafio, use o bloco Se para tomar uma decisão e chegue à entrada da casa. Você pode combinar outras ações e blocos.'
      })
    })
  });

  function positionKey(position) {
    return `${position.x},${position.y}`;
  }

  function isRoad(x, y) {
    return ROAD_ROWS.includes(y) || ROAD_COLUMNS.includes(x);
  }

  function makeGrid(challenge) {
    const grid = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => isRoad(x, y) ? 'road' : 'building'));
    challenge.obstacles.forEach(({ x, y }) => { grid[y][x] = 'blocked'; });
    return grid;
  }

  function makeConnections(grid) {
    const connections = new Set();
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (!isRoad(x, y)) continue;
        [[x + 1, y], [x, y + 1]].forEach(([nextX, nextY]) => {
          if (nextX < COLS && nextY < ROWS && isRoad(nextX, nextY)) {
            connections.add([positionKey({ x, y }), positionKey({ x: nextX, y: nextY })].sort().join('|'));
          }
        });
      }
    }
    return connections;
  }

  function walkProgram(program, visitor) {
    program.forEach((node) => {
      visitor(node);
      if (node.type === 'repeat') walkProgram(node.children || [], visitor);
      if (node.type === 'if') {
        walkProgram(node.then || [], visitor);
        walkProgram(node.else || [], visitor);
      }
    });
  }

  function validatePedagogy(challengeId, program, result) {
    const challenge = CHALLENGES[challengeId];
    if (!challenge || !Array.isArray(program) || !result || result.result !== 'complete' ||
        result.reached !== true || !Array.isArray(result.trace)) {
      return { valid: false, reason: 'A execução não alcançou o destino com um programa válido.' };
    }

    const events = result.trace;
    const commands = events.filter((event) => event.kind === 'command');
    const destination = challenge.destination.position;
    if (!result.state?.robot || result.state.robot.x !== destination.x || result.state.robot.y !== destination.y) {
      return { valid: false, reason: 'A posição final não corresponde exatamente à entrada do local.' };
    }
    const nodes = [];
    walkProgram(program, (node) => nodes.push(node));
    const requiredStructure = challenge.completionCriteria.requiredStructure;
    let usedRequiredStructure = requiredStructure === 'sequence' &&
      Array.isArray(program) && commands.some((event) => event.moved || event.turn);

    if (requiredStructure === 'repeat') {
      const repeats = new Map();
      commands.forEach((event) => {
        (event.repeatPath || []).forEach(({ node, iteration }) => {
          if (!nodes.includes(node) || node.type !== 'repeat') return;
          if (!repeats.has(node)) repeats.set(node, new Map());
          const iterations = repeats.get(node);
          if (!iterations.has(iteration)) iterations.set(iteration, []);
          iterations.get(iteration).push(event);
        });
      });
      usedRequiredStructure = [...repeats.values()].some((iterations) =>
        iterations.size >= 2 && [...iterations.values()].every((iterationEvents) =>
          iterationEvents.some((event) => event.moved || event.turn)));
    } else if (requiredStructure === 'if') {
      usedRequiredStructure = events.some((event) =>
        event.kind === 'condition' &&
        nodes.includes(event.node) &&
        event.node.type === 'if' &&
        event.condition === 'pathClear' &&
        event.branch === (event.value ? 'then' : 'else') &&
        commands.some((commandEvent) =>
          (commandEvent.conditionPath || []).some((decision) =>
            decision.node === event.node && decision.branch === event.branch) &&
          (commandEvent.moved || commandEvent.turn)));
    }

    return !usedRequiredStructure
      ? { valid: false, reason: challenge.criteria.feedback }
      : { valid: true, reason: 'O programa aplicou o conceito e alcançou a entrada designada.', destinationId: challenge.destinationId };
  }

  const api = Object.freeze({
    COLS,
    ROWS,
    ROAD_ROWS,
    ROAD_COLUMNS,
    LANDMARKS,
    CHALLENGES,
    positionKey,
    isRoad,
    makeGrid,
    makeConnections,
    validatePedagogy
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ListenerMissions = api;
})(typeof window !== 'undefined' ? window : globalThis);
