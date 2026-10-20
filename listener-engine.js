(function (global) {
  const DIRECTION_VECTORS = Object.freeze({
    0: Object.freeze({ x: 0, y: -1 }),
    90: Object.freeze({ x: 1, y: 0 }),
    180: Object.freeze({ x: 0, y: 1 }),
    270: Object.freeze({ x: -1, y: 0 })
  });
  const MAX_DEPTH = 6;
  const MAX_REPEAT = 10;
  const MAX_INSTRUCTIONS = 40;
  const COMMANDS = new Set(['move', 'forward', 'forward_long', 'turnLeft', 'turnRight', 'turn90L', 'turn90R']);
  const CONDITIONS = new Set(['pathClear']);

  function normalizeDirection(value) {
    const normalized = Number(value) || 0;
    return ((normalized % 360) + 360) % 360;
  }

  function directionVector(direction) {
    return { ...DIRECTION_VECTORS[normalizeDirection(direction)] };
  }

  function createRobotState(start = { x: 0, y: 0, dir: 90 }) {
    return {
      x: Number(start.x) || 0,
      y: Number(start.y) || 0,
      dir: normalizeDirection(start.dir)
    };
  }

  function validGrid(grid) {
    return Array.isArray(grid) && grid.length > 0 &&
      (Array.isArray(grid[0]) || typeof grid[0] === 'string') && grid[0].length > 0 &&
      grid.every((row) => (Array.isArray(row) || typeof row === 'string') && row.length === grid[0].length);
  }

  function canMoveTo(grid, x, y, options = {}) {
    if (!validGrid(grid) || !Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || y < 0 || y >= grid.length || x >= grid[0].length) return false;
    const tile = grid[y][x];
    const blockedValues = options.blockedValues || ['#', 1, 'blocked'];
    if (tile === undefined || tile === null || blockedValues.includes(tile)) return false;
    if (options.from) {
      const { x: fromX, y: fromY } = options.from;
      if (Math.abs(x - fromX) + Math.abs(y - fromY) !== 1) return false;
      if (options.connections) {
        const edge = [fromX + ',' + fromY, x + ',' + y].sort().join('|');
        if (!options.connections.has(edge)) return false;
      }
    }
    return true;
  }

  function moveRobot(robot, grid, options = {}) {
    const current = createRobotState(robot);
    const vector = directionVector(current.dir);
    const x = current.x + vector.x;
    const y = current.y + vector.y;
    if (!canMoveTo(grid, x, y, { from: current, connections: options.connections, blockedValues: options.blockedValues })) {
      return { ok: false, reason: 'blocked', state: current, nextPosition: { ...current } };
    }
    return { ok: true, reason: 'moved', state: { ...current, x, y }, nextPosition: { ...current, x, y } };
  }

  function turnRobot(robot, deltaDegrees) {
    const current = createRobotState(robot);
    return { ok: true, reason: 'turned', state: { ...current, dir: normalizeDirection(current.dir + Number(deltaDegrees || 0)) } };
  }

  function missionReached(robot, target) {
    return !!target && robot.x === Number(target.x) && robot.y === Number(target.y);
  }

  function createMissionState({ grid, start, target, connections, blockedValues } = {}) {
    if (!validGrid(grid)) throw new TypeError('O mapa deve ser uma grade retangular válida.');
    const initial = createRobotState(start);
    if (!canMoveTo(grid, initial.x, initial.y, { blockedValues })) throw new RangeError('A posição inicial não é permitida no mapa.');
    if (target && !canMoveTo(grid, Number(target.x), Number(target.y), { blockedValues })) throw new RangeError('O destino não é permitido no mapa.');
    return {
      grid,
      start: initial,
      target: target ? { x: Number(target.x), y: Number(target.y) } : null,
      connections: connections || null,
      blockedValues: blockedValues || ['#', 1, 'blocked'],
      robot: { ...initial },
      execution: { running: false, result: null, blocked: false, reason: null, instructionsExecuted: 0 }
    };
  }

  function resetMissionState(state) {
    if (!state || !state.start) throw new TypeError('O estado da missão precisa conter a posição inicial.');
    return {
      ...state,
      robot: createRobotState(state.start),
      execution: { running: false, result: null, blocked: false, reason: null, instructionsExecuted: 0 }
    };
  }

  function validateSequence(sequence, maxInstructions = MAX_INSTRUCTIONS, permissions = {}) {
    if (!Array.isArray(sequence)) return { valid: false, reason: 'A sequência deve ser um array.', count: 0 };
    let count = 0;
    function walk(nodes, depth) {
      if (depth > MAX_DEPTH) throw new Error('A sequência excedeu o limite de aninhamento.');
      if (!Array.isArray(nodes)) throw new Error('Cada bloco precisa conter uma lista de comandos válida.');
      let total = 0;
      for (const node of nodes) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Cada comando deve ser um objeto válido.');
        if (node.type === 'repeat') {
          if (permissions.allowRepeat !== true) throw new Error('O bloco Repita ainda não foi liberado nesta etapa.');
          const times = Number(node.times);
          if (!Number.isInteger(times) || times < 1 || times > MAX_REPEAT) throw new Error('O comando Repita precisa de um valor inteiro entre 1 e 10.');
          const inner = walk(node.children, depth + 1);
          if (inner === 0) throw new Error('A repetição precisa conter ao menos uma ação.');
          total += inner * times;
        } else if (node.type === 'if') {
          if (permissions.allowConditionals !== true) throw new Error('O bloco Se ainda não foi liberado nesta etapa.');
          if (!CONDITIONS.has(node.condition)) throw new Error('A condição do bloco precisa ser válida.');
          if (!Array.isArray(node.then) || !Array.isArray(node.else)) {
            throw new Error('O comando Condicional precisa de ramificações válidas.');
          }
          const thenCount = walk(node.then, depth + 1);
          const elseCount = walk(node.else || [], depth + 1);
          if (thenCount === 0) throw new Error('A condicional precisa conter ao menos uma ação no ramo Então.');
          total += Math.max(thenCount, elseCount);
        } else if (COMMANDS.has(node.type)) {
          total += node.type === 'forward_long' ? 3 : 1;
        } else {
          throw new Error(`Comando inválido: ${String(node.type)}`);
        }
        if (total > maxInstructions) break;
      }
      return total;
    }
    try {
      count = walk(sequence, 0);
    } catch (error) {
      return { valid: false, reason: error.message, count: 0 };
    }
    if (count > maxInstructions) return { valid: false, reason: 'A quantidade de instruções excedeu o limite.', count };
    return { valid: true, reason: 'ok', count };
  }

  function pathIsClear(state) {
    const vector = directionVector(state.robot.dir);
    return canMoveTo(state.grid, state.robot.x + vector.x, state.robot.y + vector.y, {
      from: state.robot,
      connections: state.connections,
      blockedValues: state.blockedValues
    });
  }

  function conditionValue(condition, state) {
    if (!CONDITIONS.has(condition)) throw new TypeError('A condição do caminho não é reconhecida.');
    return pathIsClear(state);
  }

  async function executeSequence(state, sequence, options = {}) {
    const validation = validateSequence(
      sequence,
      options.maxInstructions || MAX_INSTRUCTIONS,
      options.permissions || {}
    );
    if (!validation.valid) {
      state.execution = { running: false, result: 'invalid', blocked: false, reason: validation.reason, instructionsExecuted: 0 };
      return { ...validation, result: 'invalid', state };
    }
    if (state.execution.running) return { valid: false, reason: 'A missão já está em execução.', result: 'running', state };

    const limit = options.maxInstructions || MAX_INSTRUCTIONS;
    const trace = [];
    state.execution = { running: true, result: null, blocked: false, reason: null, instructionsExecuted: 0 };
    function record(event) {
      trace.push(event);
      if (options.onEvent) options.onEvent(event);
    }
    async function walk(nodes, depth, context = { repeatPath: [], conditionPath: [] }) {
      if (depth > MAX_DEPTH) throw new Error('A sequência excedeu o limite de aninhamento.');
      for (const command of nodes) {
        if (!state.execution.running) return;
        if (command.type === 'repeat') {
          for (let i = 0; i < Number(command.times) && state.execution.running; i++) {
            await walk(command.children, depth + 1, {
              ...context,
              repeatPath: [...context.repeatPath, { node: command, iteration: i + 1 }]
            });
          }
        } else if (command.type === 'if') {
          let iteration = 0;
          while (state.execution.running) {
            const value = conditionValue(command.condition, state);
            const branchName = value ? 'then' : 'else';
            const decision = {
              kind: 'condition',
              node: command,
              condition: command.condition,
              value,
              branch: branchName,
              iteration: iteration + 1,
              at: { x: state.robot.x, y: state.robot.y }
            };
            record(decision);
            const branch = value ? command.then : (command.else || []);
            const instructionsBeforeBranch = state.execution.instructionsExecuted;
            await walk(branch, depth + 1, {
              ...context,
              conditionPath: [...context.conditionPath, {
                node: command, condition: command.condition, value, branch: branchName
              }]
            });
            if (!value || !state.execution.running) break;
            if (state.execution.instructionsExecuted === instructionsBeforeBranch) {
              state.execution.running = false;
              state.execution.result = 'invalid';
              state.execution.reason = 'O ramo Então não executou instruções; a condição não pode avançar com segurança.';
              break;
            }
            iteration += 1;
          }
        } else {
          const forwardCount = command.type === 'forward_long' ? 3 : 1;
          const isTurn = ['turnLeft', 'turn90L', 'turnRight', 'turn90R'].includes(command.type);
          const steps = isTurn ? 1 : forwardCount;
          for (let i = 0; i < steps; i++) {
            if (!state.execution.running) return;
            state.execution.instructionsExecuted += 1;
            if (state.execution.instructionsExecuted > limit) {
              state.execution.running = false;
              state.execution.result = 'invalid';
              state.execution.reason = 'A execução excedeu o limite de instruções.';
              return;
            }
            const from = { ...state.robot };
            const event = {
              kind: 'command',
              command,
              commandType: command.type,
              from,
              repeatPath: context.repeatPath,
              conditionPath: context.conditionPath,
              moved: false,
              turn: false
            };
            if (isTurn) {
              const delta = command.type === 'turnLeft' || command.type === 'turn90L' ? -90 : 90;
              state.robot.dir = normalizeDirection(state.robot.dir + delta);
              event.turn = true;
              event.to = { ...state.robot };
              record(event);
              if (options.onTransition) await options.onTransition({ kind: 'turn', from, to: { ...state.robot }, command });
            } else {
              const moved = moveRobot(state.robot, state.grid, { connections: state.connections, blockedValues: state.blockedValues });
              if (!moved.ok) {
                event.to = { ...state.robot };
                event.blocked = true;
                record(event);
                state.execution.running = false;
                state.execution.blocked = true;
                state.execution.result = 'blocked';
                state.execution.reason = 'Movimento bloqueado: a próxima posição não está conectada ou está ocupada.';
                if (options.onBlocked) await options.onBlocked({ state, command });
                return;
              }
              Object.assign(state.robot, moved.state);
              event.moved = true;
              event.to = { ...state.robot };
              record(event);
              if (options.onTransition) await options.onTransition({ kind: 'move', from, to: { ...state.robot }, command });
            }
          }
        }
      }
    }

    try {
      await walk(sequence, 0);
    } catch (error) {
      state.execution.running = false;
      state.execution.result = 'error';
      state.execution.reason = error.message;
      throw error;
    }
    if (state.execution.running) {
      state.execution.running = false;
      state.execution.result = missionReached(state.robot, state.target) ? 'complete' : 'incomplete';
    } else if (!state.execution.result) {
      state.execution.result = 'stopped';
    }
    return {
      valid: true,
      reason: state.execution.reason || 'ok',
      result: state.execution.result,
      reached: missionReached(state.robot, state.target),
      trace,
      state
    };
  }

  function stopMission(state) {
    if (!state || !state.execution) return false;
    if (!state.execution.running) return false;
    state.execution.running = false;
    state.execution.result = 'stopped';
    state.execution.reason = null;
    return true;
  }

  const api = {
    normalizeDirection,
    directionVector,
    createRobotState,
    validGrid,
    canMoveTo,
    moveRobot,
    turnRobot,
    missionReached,
    createMissionState,
    resetMissionState,
    validateSequence,
    conditionValue,
    executeSequence,
    stopMission,
    DIRECTION_VECTORS,
    MAX_INSTRUCTIONS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ListenerEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
