(function (global) {
  'use strict';

  const Engine = global.ListenerEngine;
  const Missions = global.ListenerMissions;
  const Voice = global.ListenerVoice;
  const { CHALLENGES } = Missions;
  const WIDTH = 800;
  const HEIGHT = 470;
  const TILE_SIZE = 88;
  const GRID_LEFT = 92;
  const GRID_TOP = 15;
  const PARK_AREA = Object.freeze({ x: 4, y: 3, width: 2 });
  const FOUNDATION_LABELS = Object.freeze({
    sequencing: 'SEQUENCIAMENTO',
    repetition: 'REPETIÇÃO',
    conditionals: 'CONDICIONAIS'
  });
  const LABELS = Object.freeze({
    forward: 'Avançar',
    turn90L: 'Virar à esquerda',
    turn90R: 'Virar à direita',
    repeat: 'Repetir',
    if: 'Se o caminho à frente está livre?'
  });

  const viewState = {
    challengeId: null,
    mission: null,
    missionSpec: null,
    program: [],
    running: false,
    runId: 0,
    robotPixel: null,
    animationToken: 0,
    recognition: null,
    listening: false,
    voiceScope: null,
    completed: false,
    resizeObserver: null,
    completion: null,
    lastExecution: null
  };

  let initialized = false;
  let canvas;
  let context;
  let feedback;

  function pointFor(position) {
    return {
      x: GRID_LEFT + TILE_SIZE / 2 + position.x * TILE_SIZE,
      y: GRID_TOP + TILE_SIZE / 2 + position.y * TILE_SIZE
    };
  }

  function updateMapDescription() {
    if (!viewState.mission || !viewState.missionSpec) return;
    const directions = { 0: 'norte', 90: 'leste', 180: 'sul', 270: 'oeste' };
    const { x, y, dir } = viewState.mission.robot;
    const obstacles = viewState.missionSpec.obstacles.map(({ x: obstacleX, y: obstacleY }) =>
      `coluna ${obstacleX + 1}, linha ${obstacleY + 1}`).join('; ');
    document.getElementById('gameMapDescription').textContent =
      `Listener na rua, coluna ${x + 1}, linha ${y + 1}, voltado para ${directions[dir]}. ` +
      `Destino: ${viewState.missionSpec.destination.arrival}. ` +
      (obstacles ? `Obstáculos nas ruas: ${obstacles}.` : 'Não há obstáculos neste desafio.');
  }

  function setPlayerProfile(age) {
    document.getElementById('page-game').dataset.profile = age >= 6 && age <= 11 ? 'young' : '12-plus';
  }

  function authoredCount(program) {
    return program.reduce((sum, command) => sum + 1 +
      (command.type === 'repeat' ? authoredCount(command.children) :
        command.type === 'if' ? authoredCount(command.then) + authoredCount(command.else || []) : 0), 0);
  }

  function programmingPermissions() {
    return global.ListenerApp?.getProgrammingCapabilities(viewState.challengeId) || null;
  }

  function commandIsAvailable(type) {
    const permissions = programmingPermissions();
    if (!permissions) return false;
    if (type === 'repeat') return permissions.allowRepeat;
    if (type === 'if') return permissions.allowConditionals;
    return true;
  }

  function addCommand(type) {
    if (viewState.running || viewState.completed) return;
    if (!commandIsAvailable(type)) {
      setFeedback(type === 'repeat'
        ? 'A repetição será apresentada depois que você concluir os dois desafios de Sequenciamento.'
        : 'As condições serão apresentadas depois que você concluir os dois desafios de Repetição.', 'ready');
      return;
    }
    viewState.lastExecution = null;
    if (type === 'repeat') {
      viewState.program.push({ type: 'repeat', times: 2, children: [{ type: 'forward' }] });
    } else if (type === 'if') {
      viewState.program.push({
        type: 'if', condition: 'pathClear',
        then: [],
        else: []
      });
    } else {
      viewState.program.push({ type });
    }
    renderProgram();
  }

  function renderProgram() {
    const list = document.getElementById('gameProgram');
    if (!list) return;
    list.replaceChildren();
    updateProgrammingControls();
    document.querySelectorAll('[data-game-command]').forEach((button) => {
      const type = button.dataset.gameCommand;
      button.hidden = !commandIsAvailable(type);
      button.disabled = viewState.running || viewState.completed;
    });
    document.getElementById('clearProgram').disabled = viewState.running || viewState.completed;
    renderCommandList(viewState.program, list);
    const count = authoredCount(viewState.program);
    const run = document.getElementById('gameRun');
    run.disabled = viewState.running || viewState.completed || count === 0 || !!viewState.voiceScope;
    document.getElementById('gameStop').disabled = !viewState.running;
  }

  function renderCommandList(commands, list) {
    commands.forEach((command, index) => {
      const item = document.createElement('li');
      item.className = 'game-program-item';
      item.dataset.commandType = command.type;
      const heading = document.createElement('div');
      heading.className = 'program-block-heading';
      const label = document.createElement('span');
      label.className = 'program-block-title';
      label.textContent = command.type === 'if'
        ? 'SE o caminho à frente está livre?'
        : command.type === 'repeat' ? `Repita ${command.times} vezes` : LABELS[command.type] || command.type;
      heading.append(label);
      if (viewState.voiceScope?.node === command) {
        const open = document.createElement('span');
        open.className = 'program-open-indicator';
        open.textContent = command.type === 'if'
          ? `Voz: ramo ${viewState.voiceScope.branch === 'then' ? 'Então' : 'Senão'} aberto`
          : 'Voz: repetição aberta';
        heading.append(open);
      }
      if (command.type === 'repeat') {
        const times = document.createElement('button');
        times.type = 'button';
        times.className = 'program-edit-button';
        times.textContent = `Alterar ×${command.times}`;
        times.setAttribute('aria-label', `Alterar quantidade de repetições, atualmente ${command.times}`);
        times.addEventListener('click', () => {
          if (viewState.running || viewState.completed) return;
          command.times = command.times >= 5 ? 2 : command.times + 1;
          viewState.lastExecution = null;
          renderProgram();
        });
        heading.append(times);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'program-remove-button';
      remove.textContent = 'Remover';
      remove.setAttribute('aria-label', `Remover comando ${index + 1}`);
      remove.addEventListener('click', () => {
        if (viewState.running || viewState.completed) return;
        if (viewState.voiceScope?.node === command) viewState.voiceScope = null;
        commands.splice(index, 1);
        viewState.lastExecution = null;
        if (!document.getElementById('voiceControls').hidden) setVoiceStatus('Comando removido. Revise a sequência.', 'recognized');
        renderProgram();
      });
      heading.append(remove);
      item.append(heading);

      if (command.type === 'repeat') {
        appendNestedCommands(item, 'Ações repetidas', command.children, 'repeat');
      } else if (command.type === 'if') {
        const branches = document.createElement('div');
        branches.className = 'conditional-branches';
        [
          { name: 'then', title: 'ENTÃO — se sim' },
          { name: 'else', title: 'SENÃO — se não' }
        ].forEach(({ name, title }) => {
          const branch = document.createElement('section');
          branch.className = 'conditional-branch';
          branch.dataset.branch = name;
          if (viewState.voiceScope?.node === command && viewState.voiceScope.branch === name) {
            branch.dataset.voiceFocus = 'true';
          }
          const branchTitle = document.createElement('h4');
          branchTitle.textContent = title;
          branch.append(branchTitle);
          const childList = document.createElement('ol');
          childList.className = 'game-program-children';
          renderCommandList(command[name], childList);
          branch.append(childList);
          appendActionControls(branch, command[name], name);
          branches.append(branch);
        });
        item.append(branches);
      }
      item.querySelectorAll('button').forEach((button) => {
        button.disabled = viewState.running || viewState.completed;
      });
      list.append(item);
    });
  }

  function appendNestedCommands(parent, title, commands, scope) {
    const section = document.createElement('section');
    section.className = 'program-nested';
    const heading = document.createElement('h4');
    heading.textContent = title;
    section.append(heading);
    const childList = document.createElement('ol');
    childList.className = 'game-program-children';
    renderCommandList(commands, childList);
    section.append(childList);
    appendActionControls(section, commands, scope);
    parent.append(section);
  }

  function appendActionControls(parent, commands, scope) {
    const controls = document.createElement('div');
    controls.className = 'program-action-controls';
    [['forward', '+ Avançar'], ['turn90L', '+ Virar à esquerda'], ['turn90R', '+ Virar à direita']]
      .forEach(([type, text]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', `Adicionar ${LABELS[type]} ${scope === 'repeat' ? 'à repetição' : `ao ramo ${scope === 'then' ? 'Então' : 'Senão'}`}`);
        button.addEventListener('click', () => {
          if (viewState.running || viewState.completed) return;
          commands.push({ type });
          viewState.lastExecution = null;
          renderProgram();
        });
        controls.append(button);
      });
    if (scope !== 'repeat' && commandIsAvailable('repeat')) {
      const repeatButton = document.createElement('button');
      repeatButton.type = 'button';
      repeatButton.textContent = '+ Repetir ×2';
      repeatButton.setAttribute('aria-label', `Adicionar repetição ×2 ao ramo ${scope === 'then' ? 'Então' : 'Senão'}`);
      repeatButton.addEventListener('click', () => {
        if (viewState.running || viewState.completed) return;
        commands.push({ type: 'repeat', times: 2, children: [{ type: 'forward' }] });
        viewState.lastExecution = null;
        renderProgram();
      });
      controls.append(repeatButton);
    }
    parent.append(controls);
  }

  function updateProgrammingControls() {
    const permissions = programmingPermissions();
    if (!permissions) return;
    const repeatButton = document.querySelector('[data-game-command="repeat"]');
    const conditionalButton = document.querySelector('[data-game-command="if"]');
    repeatButton.hidden = !permissions.allowRepeat;
    conditionalButton.hidden = !permissions.allowConditionals;
    const blocksHelp = document.getElementById('blocksHelp');
    const foundationTip = permissions.foundation === 'sequencing'
      ? 'Organize os movimentos na ordem que escolher. Por enquanto, use apenas comandos básicos.'
      : permissions.foundation === 'repetition'
        ? 'Use “Repita” para executar ações mais de uma vez. Os comandos básicos continuam disponíveis.'
        : 'Use “Se” para escolher ações conforme o caminho. Os movimentos e a repetição continuam disponíveis.';
    blocksHelp.textContent = `${foundationTip} Avançar segue as ruas conectadas; prédios e barreiras bloqueiam a passagem.`;
    updateVoiceExamples(permissions);
  }

  function updateVoiceExamples(permissions) {
    const examples = document.getElementById('voiceExamples');
    const help = document.getElementById('voiceHelp');
    const lines = [['avance', 'vire à direita', 'vire à esquerda']];
    if (permissions.allowRepeat) lines.push(['repita 3 vezes', 'fim da repetição']);
    if (permissions.allowConditionals) {
      lines.push(['se o caminho estiver livre', 'senão', 'fim da condição']);
    }
    help.textContent = permissions.foundation === 'sequencing'
      ? 'Diga um movimento de cada vez. Repita e condições serão ensinadas nas próximas etapas.'
      : permissions.foundation === 'repetition'
        ? 'Diga “repita”, inclua ações e feche com “fim da repetição”. Condições virão depois.'
        : 'Diga a condição, as ações de cada ramo e “fim da condição”. Os recursos anteriores continuam disponíveis.';
    examples.replaceChildren();
    lines.flat().forEach((phrase) => {
      const item = document.createElement('li');
      item.textContent = `“${phrase}”`;
      examples.append(item);
    });
  }

  function setVoiceStatus(message, state = 'waiting') {
    const status = document.getElementById('gameVoiceStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function setMicrophoneActive(active) {
    const button = document.getElementById('gameMic');
    button.setAttribute('aria-pressed', String(active));
    document.getElementById('gameMicLabel').textContent = active ? 'Parar escuta' : 'Iniciar escuta';
  }

  function setFeedback(message, status) {
    feedback.textContent = message;
    feedback.dataset.state = status || 'ready';
    if (status !== 'running') global.ListenerApp?.announce(message);
    if (status === 'success') global.ListenerApp?.playSound('success');
    else if (status === 'blocked' || status === 'invalid' || status === 'error') global.ListenerApp?.playSound('error');
  }

  function renderHints(clearHint = false) {
    const button = document.getElementById('requestHint');
    const confirmation = document.getElementById('hintConfirmation');
    const content = document.getElementById('hintContent');
    const status = global.ListenerApp?.getHintStatus(viewState.challengeId);
    const count = status?.revealed || 0;
    button.disabled = !viewState.challengeId || viewState.running || viewState.completed || count >= (status?.maximum || 3);
    button.textContent = count >= (status?.maximum || 3)
      ? 'Dicas utilizadas'
      : `Ver dica ${count + 1} de ${status?.maximum || 3}`;
    if (clearHint) {
      confirmation.hidden = true;
      content.hidden = true;
      content.textContent = '';
    }
  }

  function showNextHint() {
    const result = global.ListenerApp?.useHint(viewState.challengeId);
    if (!result?.accepted) {
      document.getElementById('hintPenaltyWarning').textContent = result?.reason || 'Não foi possível mostrar a dica.';
      document.getElementById('hintConfirmation').hidden = false;
      return;
    }
    const content = document.getElementById('hintContent');
    content.textContent = `Dica ${result.reveal} de 3: ${result.text}`;
    content.hidden = false;
    document.getElementById('hintConfirmation').hidden = true;
    if (result.penalty) {
      content.textContent += ` Penalização acumulada neste desafio: ${result.penalty} pontos.`;
    }
    renderHints();
    global.ListenerApp?.announce(content.textContent);
  }

  function updateVisualFromModel() {
    const point = pointFor(viewState.mission.robot);
    viewState.robotPixel = { ...point, direction: viewState.mission.robot.dir };
    updateMapDescription();
    drawMap();
  }

  function startChallenge(challengeId) {
    const challenge = CHALLENGES[challengeId];
    if (!challenge || !global.ListenerApp?.getProgrammingCapabilities(challengeId)) return false;
    if (!initialized) initialize();
    stopVoice();
    viewState.animationToken += 1;
    viewState.runId += 1;
    viewState.challengeId = challengeId;
    viewState.missionSpec = challenge;
    viewState.program = [];
    viewState.completed = false;
    viewState.running = false;
    viewState.completion = null;
    viewState.lastExecution = null;
    viewState.voiceScope = null;
    document.getElementById('gameCompletion').hidden = true;
    const grid = Missions.makeGrid(challenge);
    viewState.mission = Engine.createMissionState({
      grid,
      start: challenge.start,
      target: challenge.destination.position,
      connections: Missions.makeConnections(grid),
      blockedValues: ['building', 'blocked']
    });
    setPlayerProfile(global.ListenerApp?.getState().session?.player.age || 0);
    viewState.robotPixel = { ...pointFor(challenge.start), direction: challenge.start.dir };
    document.getElementById('gameFoundationLabel').textContent = FOUNDATION_LABELS[challenge.foundation];
    document.getElementById('gameChallengeTitle').textContent = challenge.title;
    document.getElementById('gameChallengeDescription').textContent = challenge.description;
    document.getElementById('gameChallengeCount').textContent = `Desafio ${challenge.number} de 6`;
    canvas.setAttribute('aria-label', `Mapa urbano. Destino: ${challenge.destination.arrival}.`);
    updateMapDescription();
    setFeedback(`Destino: ${challenge.destination.arrival}. Monte o programa e execute.`, 'ready');
    renderProgram();
    renderHints(true);
    drawMap();
    return true;
  }

  function resizeCanvas() {
    if (!canvas || !context) return;
    const dpr = Math.min(2, Math.max(1, global.devicePixelRatio || 1));
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap();
  }

  function initialize() {
    if (initialized) return;
    canvas = document.getElementById('gameMap');
    if (!canvas || !Engine) return;
    context = canvas.getContext('2d');
    feedback = document.getElementById('gameFeedback');
    initialized = true;
    document.querySelectorAll('[data-game-command]').forEach((button) => {
      button.addEventListener('click', () => addCommand(button.dataset.gameCommand));
    });
    document.getElementById('clearProgram').addEventListener('click', () => {
      if (viewState.running) return;
      viewState.program = [];
      viewState.voiceScope = null;
      viewState.lastExecution = null;
      renderProgram();
      if (!document.getElementById('voiceControls').hidden) {
        setVoiceStatus('Sequência limpa. Toque no microfone e diga um novo comando.', 'waiting');
      }
    });
    document.getElementById('gameRun').addEventListener('click', runProgram);
    document.getElementById('gameStop').addEventListener('click', stopProgram);
    document.getElementById('gameReset').addEventListener('click', resetChallenge);
    document.getElementById('requestHint').addEventListener('click', () => {
      const age = global.ListenerApp?.getState().session?.player.age || 0;
      if (age >= 12) {
        document.getElementById('hintPenaltyWarning').textContent =
          'Esta dica reduz 10 pontos do desafio. A penalização de dicas tem limite total de 30 pontos por desafio. Deseja continuar?';
        document.getElementById('hintConfirmation').hidden = false;
        document.getElementById('confirmHint').focus();
        return;
      }
      showNextHint();
    });
    document.getElementById('confirmHint').addEventListener('click', showNextHint);
    document.getElementById('cancelHint').addEventListener('click', () => {
      document.getElementById('hintConfirmation').hidden = true;
      document.getElementById('requestHint').focus();
    });
    document.getElementById('blocksMode').addEventListener('click', () => setMode('blocks'));
    document.getElementById('voiceMode').addEventListener('click', () => setMode('voice'));
    document.getElementById('gameMic').addEventListener('click', toggleVoice);
    document.getElementById('nextGameChallenge').addEventListener('click', () => {
      if (viewState.completion?.allComplete) global.ListenerApp?.openExperienceCompletion();
      else if (viewState.completion?.nextChallengeId) global.ListenerApp?.startChallenge(viewState.completion.nextChallengeId);
      else global.ListenerApp?.returnToTrail();
    });
    document.getElementById('completionBackToTrail').addEventListener('click', () => global.ListenerApp?.returnToTrail());
    const mapFrame = canvas.parentElement;
    if ('ResizeObserver' in global) {
      viewState.resizeObserver = new ResizeObserver(resizeCanvas);
      viewState.resizeObserver.observe(mapFrame);
    } else {
      global.addEventListener('resize', resizeCanvas);
    }
    resizeCanvas();
  }

  function setMode(mode) {
    const blocks = mode === 'blocks';
    if (blocks) stopVoice();
    document.getElementById('blocksMode').setAttribute('aria-selected', String(blocks));
    document.getElementById('voiceMode').setAttribute('aria-selected', String(!blocks));
    document.getElementById('blocksControls').hidden = !blocks;
    document.getElementById('voiceControls').hidden = blocks;
    if (!blocks) setVoiceStatus('Pronto para ouvir um comando.', 'waiting');
  }

  function resetChallenge() {
    if (!viewState.mission) return;
    stopProgram();
    stopVoice();
    viewState.runId += 1;
    viewState.animationToken += 1;
    viewState.mission = Engine.resetMissionState(viewState.mission);
    viewState.completed = false;
    viewState.completion = null;
    viewState.lastExecution = null;
    viewState.program = [];
    viewState.voiceScope = null;
    document.getElementById('gameCompletion').hidden = true;
    renderHints(true);
    updateVisualFromModel();
    updateMapDescription();
    renderProgram();
    setFeedback('Desafio reiniciado. A sequência foi limpa e o progresso continua preservado.', 'ready');
  }

  function resetSession() {
    stopProgram();
    stopVoice();
    viewState.runId += 1;
    viewState.animationToken += 1;
    viewState.challengeId = null;
    viewState.mission = null;
    viewState.missionSpec = null;
    viewState.program = [];
    viewState.running = false;
    viewState.robotPixel = null;
    viewState.voiceScope = null;
    viewState.completed = false;
    viewState.completion = null;
    viewState.lastExecution = null;
    document.getElementById('gameCompletion').hidden = true;
    document.getElementById('blocksMode').setAttribute('aria-selected', 'true');
    document.getElementById('voiceMode').setAttribute('aria-selected', 'false');
    document.getElementById('blocksControls').hidden = false;
    document.getElementById('voiceControls').hidden = true;
    document.getElementById('gameMapDescription').textContent = '';
    document.getElementById('gameFoundationLabel').textContent = '';
    document.getElementById('gameChallengeTitle').textContent = '';
    document.getElementById('gameChallengeDescription').textContent = '';
    document.getElementById('gameChallengeCount').textContent = '';
    document.getElementById('hintConfirmation').hidden = true;
    document.getElementById('hintContent').hidden = true;
    document.getElementById('hintContent').textContent = '';
    setFeedback('Monte uma sequência e execute o programa.', 'ready');
    renderProgram();
    drawMap();
  }

  function stopProgram() {
    if (!viewState.mission || !viewState.running) return;
    Engine.stopMission(viewState.mission);
    viewState.running = false;
    viewState.runId += 1;
    viewState.animationToken += 1;
    const point = pointFor(viewState.mission.robot);
    viewState.robotPixel = { ...point, direction: viewState.mission.robot.dir };
    updateMapDescription();
    renderProgram();
    drawMap();
    setFeedback('Execução interrompida. O desafio pode ser reiniciado para tentar novamente.', 'ready');
  }

  async function runProgram() {
    if (!viewState.mission || viewState.running || viewState.completed) return;
    if (viewState.voiceScope) {
      setFeedback('Encerre o bloco de voz e revise suas ações antes de executar.', 'invalid');
      return;
    }
    if (!viewState.program.length) {
      setFeedback('Adicione pelo menos um comando antes de executar.', 'invalid');
      return;
    }
    const permissions = programmingPermissions();
    if (!permissions) {
      setFeedback('Este desafio ainda não está liberado na trilha.', 'invalid');
      return;
    }
    const authorized = Engine.validateSequence(viewState.program, Engine.MAX_INSTRUCTIONS, permissions);
    if (!authorized.valid) {
      setFeedback(authorized.reason, 'invalid');
      if (!document.getElementById('voiceControls').hidden) setVoiceStatus(authorized.reason, 'error');
      return;
    }
    stopVoice();
    viewState.animationToken += 1;
    viewState.mission = Engine.resetMissionState(viewState.mission);
    updateVisualFromModel();
    viewState.running = true;
    const currentRunId = ++viewState.runId;
    const mission = viewState.mission;
    setFeedback('Executando o programa…', 'running');
    if (!document.getElementById('voiceControls').hidden) setVoiceStatus('O Listener está seguindo a sequência…', 'running');
    renderProgram();
    const result = await Engine.executeSequence(mission, viewState.program, {
      permissions,
      onTransition: animateTransition,
      onBlocked: async () => {
        setFeedback('Caminho bloqueado. O Listener não pode avançar por esta posição.', 'blocked');
      }
    });
    if (currentRunId !== viewState.runId || mission !== viewState.mission) return;
    viewState.lastExecution = result;
    viewState.running = false;
    updateMapDescription();
    renderProgram();
    if (result.result === 'complete' && result.reached) {
      const pedagogy = Missions.validatePedagogy(viewState.challengeId, viewState.program, result);
      if (!pedagogy.valid) {
        setFeedback(pedagogy.reason, 'invalid');
        if (!document.getElementById('voiceControls').hidden) setVoiceStatus(pedagogy.reason, 'error');
        drawMap();
        return;
      }
      const completion = global.ListenerApp?.completeChallenge(viewState.challengeId, result) || { accepted: false };
      if (!completion.accepted) {
        setFeedback(completion.reason || 'Não foi possível registrar a conclusão deste desafio.', 'invalid');
        return;
      }
      viewState.completed = true;
      viewState.completion = completion;
      renderProgram();
      const persistenceNotice = completion.progressSaved === false
        ? ' O progresso vale nesta sessão, mas não foi salvo neste navegador.'
        : '';
      setFeedback(`Destino alcançado: ${viewState.missionSpec.destination.arrival}. Você ganhou ${completion.points} pontos${completion.hintPenalty ? ` após ${completion.hintPenalty} pontos de penalização por dicas` : ''}.${persistenceNotice}`, 'success');
      renderHints();
      if (!document.getElementById('voiceControls').hidden) setVoiceStatus('Missão concluída! Você chegou ao destino.', 'complete');
      showCompletion(completion);
      drawMap();
      return;
    }
    if (result.result === 'blocked') setFeedback(result.reason, 'blocked');
    else if (result.result === 'invalid' || result.result === 'error') setFeedback(result.reason || 'Programa inválido.', 'invalid');
    else if (result.result === 'stopped') setFeedback('Execução interrompida.', 'ready');
    else setFeedback(`Ainda não chegou a ${viewState.missionSpec.destination.arrival}. Ajuste o programa e tente novamente.`, 'ready');
    if (!document.getElementById('voiceControls').hidden) {
      setVoiceStatus(result.result === 'blocked'
        ? 'A rua está bloqueada. Revise a sequência e tente outra vez.'
        : result.result === 'stopped'
          ? 'Execução interrompida. A sequência continua disponível para edição.'
          : 'Ainda não chegou ao destino. Revise a sequência e tente outra vez.',
      result.result === 'blocked' ? 'error' : 'waiting');
    }
    drawMap();
  }

  function showCompletion(completion) {
    const title = document.getElementById('completionTitle');
    const eyebrow = document.getElementById('completionEyebrow');
    const message = document.getElementById('completionMessage');
    const nextButton = document.getElementById('nextGameChallenge');
    const trailButton = document.getElementById('completionBackToTrail');
    const young = completion.ageBand === 'young';
    const persistenceNotice = completion.progressSaved === false
      ? ' O progresso vale nesta sessão, mas não foi salvo neste navegador.'
      : '';
    const foundationNames = { sequencing: 'Sequenciamento', repetition: 'Repetição', conditionals: 'Condicionais' };
    document.getElementById('gameCompletion').hidden = false;
    nextButton.hidden = !completion.nextChallengeId;
    if (completion.allComplete) {
      eyebrow.textContent = 'TRILHA CONCLUÍDA';
      title.textContent = young ? 'Você completou a trilha!' : 'Trilha concluída!';
      message.textContent = young
        ? 'Você ensinou o Listener a organizar passos, repetir ações e escolher caminhos. Parabéns!'
        : 'Você concluiu os seis desafios e aplicou Sequenciamento, Repetição e Condicionais.';
      message.textContent += ` Pontuação deste desafio: ${completion.points} pontos.${persistenceNotice}`;
      nextButton.textContent = 'Continuar para avaliação';
      nextButton.hidden = false;
      trailButton.hidden = true;
      return;
    }
    trailButton.hidden = false;
    if (completion.foundationCompleted) {
      const nextName = foundationNames[completion.nextFoundation];
      eyebrow.textContent = 'NOVO FUNDAMENTO LIBERADO';
      title.textContent = 'Fundamento concluído!';
      message.textContent = completion.completedFoundation === 'sequencing'
        ? young
          ? 'Você organizou uma sequência de comandos. Agora vamos repetir ações juntos!'
          : 'Você aprendeu a organizar comandos em sequência. Agora, vamos descobrir como repetir ações de forma inteligente.'
        : young
          ? 'Você dominou as repetições. Agora vamos ensinar o Listener a escolher caminhos!'
          : 'Você dominou as repetições. Agora, vamos ensinar o Listener a tomar decisões.';
      message.textContent += ` Você ganhou ${completion.points} pontos neste desafio.${persistenceNotice}`;
      nextButton.textContent = `Começar ${nextName}`;
      trailButton.textContent = 'Voltar à trilha';
      return;
    }
    eyebrow.textContent = 'DESAFIO CONCLUÍDO';
    title.textContent = young ? 'Muito bem!' : 'Desafio concluído!';
    message.textContent = young
      ? `Você chegou ${viewState.missionSpec.destination.arrival}. Vamos para o próximo desafio!`
      : `Você chegou ${viewState.missionSpec.destination.arrival} e aplicou ${viewState.missionSpec.concept}. O próximo desafio do fundamento já está liberado.`;
    message.textContent += ` Pontuação deste desafio: ${completion.points} pontos${completion.hintPenalty ? `, após ${completion.hintPenalty} pontos de penalização por dicas` : ''}.${persistenceNotice}`;
    nextButton.textContent = 'Próximo desafio';
    trailButton.textContent = 'Voltar à trilha';
  }


  async function animateTransition({ kind, from, to }) {
    const token = viewState.animationToken;
    const fromPoint = pointFor(from);
    const toPoint = pointFor(to);
    const start = global.performance.now();
    const reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      global.ListenerApp?.getSettings().reducedMotion;
    const duration = reducedMotion ? 1 : kind === 'turn' ? 170 : 240;
    await new Promise((resolve) => {
      function frame(now) {
        if (token !== viewState.animationToken) {
          resolve();
          return;
        }
        const progress = Math.min(1, (now - start) / duration);
        const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        viewState.robotPixel = {
          x: fromPoint.x + (toPoint.x - fromPoint.x) * eased,
          y: fromPoint.y + (toPoint.y - fromPoint.y) * eased,
          direction: kind === 'turn' ? from.dir + shortestTurn(from.dir, to.dir) * eased : from.dir
        };
        drawMap();
        if (progress < 1) global.requestAnimationFrame(frame);
        else resolve();
      }
      global.requestAnimationFrame(frame);
    });
    if (token === viewState.animationToken) {
      viewState.robotPixel = { ...toPoint, direction: to.dir };
      drawMap();
    }
  }

  function shortestTurn(from, to) {
    let delta = ((to - from + 540) % 360) - 180;
    if (delta === -180) delta = 180;
    return delta;
  }

  function addVoiceAction(type) {
    if (viewState.running || viewState.completed) return;
    if (viewState.voiceScope?.type === 'repeat') {
      viewState.voiceScope.node.children.push({ type });
      viewState.lastExecution = null;
      renderProgram();
      return;
    }
    if (viewState.voiceScope?.type === 'if') {
      viewState.voiceScope.node[viewState.voiceScope.branch].push({ type });
      viewState.lastExecution = null;
      renderProgram();
      return;
    }
    addCommand(type);
  }

  function appendVoiceStructure(type, times = 2) {
    if (viewState.voiceScope) {
      setVoiceStatus('Encerre este bloco antes de abrir outro.', 'error');
      return false;
    }
    if (!commandIsAvailable(type)) {
      setVoiceStatus(type === 'repeat'
        ? 'A repetição aparece quando você começar esse fundamento.'
        : 'As condições aparecem quando você começar esse fundamento.', 'error');
      return false;
    }
    const command = type === 'repeat'
      ? { type, times, children: [] }
      : { type, condition: 'pathClear', then: [], else: [] };
    viewState.program.push(command);
    viewState.voiceScope = type === 'repeat'
      ? { type: 'repeat', node: command }
      : { type: 'if', node: command, branch: 'then' };
    viewState.lastExecution = null;
    renderProgram();
    const label = type === 'repeat' ? `Repetir ${times} vezes` : 'Se o caminho à frente estiver livre';
    setVoiceStatus(`Reconhecido: ${label}. Diga as ações que entram no bloco.`, 'recognized');
    return true;
  }

  function handleVoiceTranscript(rawTranscript) {
    if (viewState.running || viewState.completed) return;
    const permissions = programmingPermissions();
    if (!permissions) {
      setVoiceStatus('Este desafio não está liberado. Volte à trilha para continuar.', 'error');
      return;
    }
    const parsed = Voice.parseTranscript(rawTranscript, permissions);
    if (parsed.type === 'locked') {
      const message = parsed.foundation === 'repetition'
        ? 'Esse comando será apresentado depois que você concluir os dois desafios de Sequenciamento.'
        : 'Esse comando será apresentado depois que você concluir os dois desafios de Repetição.';
      setVoiceStatus(message, 'locked');
      return;
    }
    if (parsed.type === 'else') {
      if (viewState.voiceScope?.type !== 'if') {
        setVoiceStatus('“Senão” funciona dentro de um bloco “Se”. Diga uma condição primeiro.', 'error');
        return;
      }
      viewState.voiceScope.branch = 'else';
      setVoiceStatus('Reconhecido: Senão. Os próximos comandos ficam no outro caminho.', 'recognized');
      renderProgram();
      return;
    }
    if (parsed.type === 'endBlock') {
      if (!viewState.voiceScope) {
        setVoiceStatus('Não há um bloco aberto para encerrar.', 'error');
        return;
      }
      const closedType = viewState.voiceScope.type;
      viewState.voiceScope = null;
      setVoiceStatus(closedType === 'repeat'
        ? 'Repetição encerrada. Confira a sequência antes de executar.'
        : 'Condição encerrada. Confira a sequência antes de executar.', 'recognized');
      renderProgram();
      return;
    }
    if (parsed.type === 'endRepeat') {
      if (viewState.voiceScope?.type !== 'repeat') {
        setVoiceStatus('Não há uma repetição aberta para encerrar.', 'error');
        return;
      }
      viewState.voiceScope = null;
      setVoiceStatus('Repetição encerrada. Confira a sequência antes de executar.', 'recognized');
      renderProgram();
      return;
    }
    if (parsed.type === 'endCondition') {
      if (viewState.voiceScope?.type !== 'if') {
        setVoiceStatus('Não há uma condição aberta para encerrar.', 'error');
        return;
      }
      viewState.voiceScope = null;
      setVoiceStatus('Condição encerrada. Confira a sequência antes de executar.', 'recognized');
      renderProgram();
      return;
    }
    if (parsed.type === 'repeat') {
      appendVoiceStructure('repeat', parsed.times);
      return;
    }
    if (parsed.type === 'if') {
      appendVoiceStructure('if');
      return;
    }
    if (parsed.type === 'action') {
      const currentLength = viewState.program.length;
      const currentScope = viewState.voiceScope;
      addVoiceAction(parsed.command);
      if (viewState.program.length > currentLength || currentScope) {
        setVoiceStatus(`Reconhecido: ${LABELS[parsed.command]}. Confira a sequência abaixo; use “remover” para corrigir.`, 'recognized');
      } else {
        setVoiceStatus('O comando não foi adicionado. Confira a etapa atual e tente de novo.', 'error');
      }
      return;
    }
    const suggestion = permissions.foundation === 'sequencing'
      ? 'Tente dizer “avance”.'
      : permissions.foundation === 'repetition'
        ? 'Tente dizer “avance” ou “repita 3 vezes”.'
        : 'Tente dizer “se o caminho estiver livre”, “senão” ou “fim da condição”.';
    setVoiceStatus(`Não entendi esse comando. ${suggestion}`, 'error');
  }

  function toggleVoice() {
    if (viewState.listening) {
      const recognition = viewState.recognition;
      viewState.recognition = null;
      recognition?.stop();
      viewState.listening = false;
      setMicrophoneActive(false);
      setVoiceStatus('Escuta pausada. Toque no microfone para continuar.', 'waiting');
      return;
    }
    const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus('A voz não está disponível neste navegador. Você pode programar usando Blocos.', 'error');
      return;
    }
    const recognition = new SpeechRecognition();
    viewState.recognition = recognition;
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      if (viewState.recognition !== recognition) return;
      const transcript = event.results[event.results.length - 1][0].transcript;
      handleVoiceTranscript(transcript);
    };
    recognition.onerror = (event) => {
      if (viewState.recognition !== recognition) return;
      viewState.recognition = null;
      viewState.listening = false;
      setMicrophoneActive(false);
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'O microfone está bloqueado. Permita o acesso ou use Blocos.'
        : event.error === 'no-speech'
          ? 'Não ouvi um comando. Tente dizer “avance”.'
          : 'Não consegui ouvir esse comando. Tente novamente.';
      setVoiceStatus(message, 'error');
    };
    recognition.onend = () => {
      if (viewState.recognition !== recognition) return;
      viewState.recognition = null;
      if (!viewState.listening) return;
      viewState.listening = false;
      setMicrophoneActive(false);
      setVoiceStatus('Escuta pausada. Toque no microfone para continuar.', 'waiting');
    };
    try {
      recognition.start();
      viewState.listening = true;
      setMicrophoneActive(true);
      setVoiceStatus('Ouvindo… Diga um comando.', 'listening');
    } catch (error) {
      viewState.listening = false;
      setMicrophoneActive(false);
      setVoiceStatus('Não consegui iniciar o microfone. Confira a permissão ou use Blocos.', 'error');
    }
  }

  function stopVoice() {
    const recognition = viewState.recognition;
    viewState.recognition = null;
    viewState.listening = false;
    recognition?.stop();
    setMicrophoneActive(false);
    if (recognition) setVoiceStatus('Escuta pausada. Toque no microfone para continuar.', 'waiting');
  }

  function drawMap() {
    if (!context || !canvas) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = '#08090b';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawRoadNetwork();
    drawLots();
    drawObstacles();
    if (viewState.mission) {
      const target = pointFor(viewState.mission.target);
      drawDestination(target.x, target.y, viewState.missionSpec.destination.name);
      const start = pointFor(viewState.mission.start);
      drawStartMarker(start.x, start.y);
      drawRobot(viewState.robotPixel || { ...pointFor(viewState.mission.robot), direction: viewState.mission.robot.dir });
    }
  }

  function drawLots() {
    const challenge = CHALLENGES[viewState.challengeId];
    if (!challenge) return;
    const grid = Missions.makeGrid(challenge);
    const landmarkByCell = new Map(Object.values(Missions.LANDMARKS)
      .map((landmark) => [`${landmark.lot.x},${landmark.lot.y}`, landmark]));

    grid.forEach((row, y) => row.forEach((cell, x) => {
      if (cell !== 'building') return;
      if (x >= PARK_AREA.x && x < PARK_AREA.x + PARK_AREA.width && y === PARK_AREA.y) return;
      const landmark = landmarkByCell.get(`${x},${y}`);
      drawCityBlock(x, y, landmark);
    }));
    drawParkArea();
  }

  function drawRoadNetwork() {
    const challenge = CHALLENGES[viewState.challengeId];
    if (!challenge) return;
    const grid = Missions.makeGrid(challenge);
    const ground = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    ground.addColorStop(0, '#789c62');
    ground.addColorStop(.55, '#8eae6e');
    ground.addColorStop(1, '#698e59');
    context.fillStyle = ground;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.lineCap = 'butt';
    context.setLineDash([]);

    const roads = Array.from(Missions.makeConnections(grid), (edge) => {
      const [fromKey, toKey] = edge.split('|');
      const [fromX, fromY] = fromKey.split(',').map(Number);
      const [toX, toY] = toKey.split(',').map(Number);
      return [pointFor({ x: fromX, y: fromY }), pointFor({ x: toX, y: toY })];
    });
    const strokeRoads = (color, width) => {
      roads.forEach(([from, to]) => {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.strokeStyle = color;
        context.lineWidth = width;
        context.stroke();
      });
    };

    strokeRoads('#c9bd9e', 70);
    strokeRoads('#b3a783', 59);
    strokeRoads('#41484a', 53);

    grid.forEach((row, y) => row.forEach((_cell, x) => {
      if (!Missions.isRoad(x, y)) return;
      const horizontal = Missions.isRoad(x - 1, y) || Missions.isRoad(x + 1, y);
      const vertical = Missions.isRoad(x, y - 1) || Missions.isRoad(x, y + 1);
      const center = pointFor({ x, y });
      const width = horizontal ? TILE_SIZE - 4 : 50;
      const height = vertical ? TILE_SIZE - 4 : 50;
      context.beginPath();
      context.roundRect(center.x - width / 2, center.y - height / 2, width, height, 3);
      context.fillStyle = (x + y) % 2 ? '#454c4e' : '#41484a';
      context.fill();
      context.strokeStyle = 'rgba(237, 233, 217, .28)';
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.roundRect(center.x - width / 2 + 4, center.y - height / 2 + 4, width - 8, height - 8, 2);
      context.strokeStyle = 'rgba(14, 18, 19, .3)';
      context.lineWidth = 1;
      context.stroke();
    }));

    roads.forEach(([from, to]) => {
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.strokeStyle = '#e0c568';
      context.lineWidth = 2;
      context.setLineDash([10, 16]);
      context.stroke();
      context.setLineDash([]);
    });

    context.lineCap = 'butt';
    [[3, 2], [0, 2], [6, 2]].forEach(([x, y]) => {
      const center = pointFor({ x, y });
      for (let stripe = -2; stripe <= 2; stripe += 1) {
        context.fillStyle = 'rgba(255,255,255,.68)';
        context.fillRect(center.x + stripe * 6 - 1.5, center.y + 21, 3, 9);
      }
    });
    [[42, 91], [753, 108], [45, 343], [752, 369]].forEach(([x, y]) => drawGardenTree(x, y));
  }

  function drawCityBlock(column, row, landmark) {
    const left = GRID_LEFT + column * TILE_SIZE + 8;
    const top = GRID_TOP + row * TILE_SIZE + 8;
    const size = TILE_SIZE - 16;
    const kind = landmark?.kind || 'house';
    const palettes = [
      { front: '#f0d17b', side: '#b88945', roof: '#cb070b' },
      { front: '#e6dfc9', side: '#a89b7b', roof: '#cb070b' },
      { front: '#b8d5d0', side: '#668f87', roof: '#487b70' },
      { front: '#d8c4ed', side: '#9279b0', roof: '#745690' },
      { front: '#e6dfc9', side: '#a89b7b', roof: '#a89b7b' }
    ];
    const palette = palettes[(column * 3 + row) % palettes.length];
    const front = landmark?.colors?.front || palette.front;
    const side = landmark?.colors?.side || palette.side;
    const roof = landmark?.colors?.roof || palette.roof;
    const center = pointFor({ x: column, y: row });

    const lawns = ['#669459', '#79a45f', '#89a85f', '#6f9d70'];
    context.fillStyle = lawns[(column + row * 2) % lawns.length];
    context.beginPath();
    context.roundRect(left + 5, top + 5, size - 10, size - 10, 12);
    context.fill();
    context.fillStyle = 'rgba(205, 224, 156, .35)';
    context.beginPath();
    context.ellipse(left + 21, top + 18, 14, 7, -.35, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(48, 79, 48, .2)';
    context.beginPath();
    context.ellipse(center.x + 1, center.y + 20, 28, 7, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = 'rgba(48, 55, 40, .24)';
    context.beginPath();
    context.ellipse(center.x + 3, center.y + 12, 30, 10, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = side;
    context.beginPath();
    context.moveTo(center.x + 14, center.y - 16);
    context.lineTo(center.x + 25, center.y - 23);
    context.lineTo(center.x + 25, center.y + 7);
    context.lineTo(center.x + 14, center.y + 14);
    context.closePath();
    context.fill();
    context.fillStyle = front;
    context.beginPath();
    context.moveTo(center.x - 26, center.y - 15);
    context.lineTo(center.x - 26, center.y + 9);
    context.lineTo(center.x + 14, center.y + 14);
    context.lineTo(center.x + 14, center.y - 16);
    context.closePath();
    context.fill();
    context.fillStyle = roof;
    context.beginPath();
    context.moveTo(center.x - 31, center.y - 15);
    context.lineTo(center.x - 7, center.y - 32);
    context.lineTo(center.x + 20, center.y - 18);
    context.lineTo(center.x + 14, center.y - 12);
    context.lineTo(center.x - 8, center.y - 23);
    context.lineTo(center.x - 26, center.y - 10);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(255,255,255,.26)';
    context.beginPath();
    context.moveTo(center.x - 7, center.y - 32);
    context.lineTo(center.x + 20, center.y - 18);
    context.lineTo(center.x + 14, center.y - 12);
    context.lineTo(center.x - 8, center.y - 23);
    context.closePath();
    context.fill();
    context.fillStyle = '#252729';
    context.fillRect(center.x - 19, center.y - 11, 8, 8);
    context.fillRect(center.x + 1, center.y - 11, 8, 8);
    context.fillStyle = '#c8c2ae';
    context.fillRect(center.x + 8, center.y - 3, 6, 17);
    if (landmark) drawLandmarkSymbol(kind, center);
    drawGardenTree(center.x + 28, center.y + 27);
    drawFlower(center.x - 30, center.y + 25, '#f1d567');
    drawFlower(center.x + 27, center.y - 30, '#f4f1e9');

    if (landmark) {
      context.fillStyle = 'rgba(5,6,7,.9)';
      context.fillRect(left + 3, top + size - 12, size - 6, 13);
      context.fillStyle = '#f4f1e9';
      context.font = 'bold 8px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const label = landmark.name === 'Casa da Rua Leste' ? 'CASA LESTE' : landmark.name.toUpperCase();
      context.fillText(label, center.x, top + size - 5, size - 8);
    } else {
      drawGardenTree(center.x + 23, center.y + 23);
    }
  }

  function drawLandmarkSymbol(kind, center) {
    context.fillStyle = 'rgba(38, 47, 41, .9)';
    context.beginPath();
    context.arc(center.x + 21, center.y - 21, 10, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(center.x + 21, center.y - 21, 8, 0, Math.PI * 2);
    context.fill();
    if (kind === 'hospital') {
      context.fillStyle = '#fff';
      context.beginPath();
      context.arc(center.x + 21, center.y - 21, 7, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#cb070b';
      context.fillRect(center.x + 19, center.y - 26, 4, 10);
      context.fillRect(center.x + 16, center.y - 23, 10, 4);
    } else if (kind === 'school') {
      context.fillStyle = '#33291e';
      context.fillRect(center.x + 20, center.y - 27, 2, 13);
      context.fillStyle = '#cb070b';
      context.beginPath();
      context.moveTo(center.x + 22, center.y - 26);
      context.lineTo(center.x + 29, center.y - 24);
      context.lineTo(center.x + 22, center.y - 21);
      context.closePath();
      context.fill();
    } else if (kind === 'market') {
      context.fillStyle = '#cb070b';
      context.fillRect(center.x + 16, center.y - 25, 10, 3);
      context.fillStyle = '#f4eee0';
      context.fillRect(center.x + 17, center.y - 22, 8, 7);
      context.fillStyle = '#cb070b';
      context.fillRect(center.x + 19, center.y - 22, 2, 6);
    } else {
      context.fillStyle = '#cb070b';
      context.beginPath();
      context.moveTo(center.x + 15, center.y - 20);
      context.lineTo(center.x + 21, center.y - 26);
      context.lineTo(center.x + 27, center.y - 20);
      context.fill();
      context.fillStyle = '#f0d17b';
      context.fillRect(center.x + 17, center.y - 20, 8, 7);
      context.fillStyle = '#252729';
      context.fillRect(center.x + 20, center.y - 17, 3, 4);
    }
  }

  function drawParkArea() {
    const left = GRID_LEFT + PARK_AREA.x * TILE_SIZE + 4;
    const top = GRID_TOP + PARK_AREA.y * TILE_SIZE + 4;
    const width = PARK_AREA.width * TILE_SIZE - 8;
    const height = TILE_SIZE - 8;
    context.fillStyle = '#477a49';
    context.beginPath();
    context.roundRect(left, top, width, height, 13);
    context.fill();
    context.fillStyle = '#79a95e';
    context.beginPath();
    context.roundRect(left + 4, top + 4, width - 8, height - 8, 10);
    context.fill();
    context.fillStyle = 'rgba(222, 204, 150, .94)';
    context.beginPath();
    context.moveTo(left + 12, top + 57);
    context.quadraticCurveTo(left + 47, top + 38, left + 79, top + 50);
    context.quadraticCurveTo(left + 111, top + 63, left + 155, top + 38);
    context.lineWidth = 10;
    context.lineCap = 'round';
    context.strokeStyle = 'rgba(222, 204, 150, .94)';
    context.stroke();
    context.fillStyle = '#69b8c2';
    context.beginPath();
    context.ellipse(left + 112, top + 31, 17, 8, -.15, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(222, 244, 235, .75)';
    context.lineWidth = 2;
    context.stroke();
    [[left + 20, top + 29], [left + 56, top + 51], [left + 151, top + 26], [left + 151, top + 61]]
      .forEach(([x, y]) => drawGardenTree(x, y));
    drawFlower(left + 76, top + 26, '#f1d567');
    drawFlower(left + 128, top + 62, '#f4f1e9');
    context.fillStyle = 'rgba(5,6,7,.86)';
    context.fillRect(left + 58, top + height - 13, 54, 11);
    context.fillStyle = '#fff';
    context.font = 'bold 8px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('PRAÇA', left + 85, top + height - 7);
  }

  function drawFlower(x, y, color) {
    context.fillStyle = '#517344';
    context.fillRect(x - 1, y, 2, 6);
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y - 1, 3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f6e69b';
    context.beginPath();
    context.arc(x, y - 1, 1, 0, Math.PI * 2);
    context.fill();
  }

  function drawGardenTree(x, y) {
    context.fillStyle = '#79583c';
    context.fillRect(x - 2, y + 3, 4, 9);
    context.fillStyle = '#2f5d3a';
    context.beginPath();
    context.arc(x, y, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#6fa854';
    context.beginPath();
    context.arc(x - 3, y - 3, 4, 0, Math.PI * 2);
    context.fill();
  }

  function drawObstacles() {
    if (!viewState.mission) return;
    const challenge = CHALLENGES[viewState.challengeId];
    challenge.obstacles.forEach(({ x, y }) => {
      const point = pointFor({ x, y });
      context.fillStyle = 'rgba(0,0,0,.38)';
      context.beginPath();
      context.ellipse(point.x, point.y + 9, 26, 4, 0, 0, Math.PI * 2);
      context.fill();
      context.save();
      context.fillStyle = '#cb070b';
      [-19, 19].forEach((offset) => {
        context.fillRect(point.x + offset - 2, point.y - 1, 4, 11);
      });
      context.beginPath();
      context.roundRect(point.x - 25, point.y - 9, 50, 12, 2);
      context.fillStyle = '#e5b64f';
      context.fill();
      context.strokeStyle = '#252729';
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.roundRect(point.x - 23, point.y - 7, 46, 8, 1);
      context.clip();
      for (let offset = -36; offset < 58; offset += 14) {
        context.fillStyle = offset % 2 === 0 ? '#252729' : '#f1d687';
        context.beginPath();
        context.moveTo(point.x + offset, point.y - 8);
        context.lineTo(point.x + offset + 8, point.y - 8);
        context.lineTo(point.x + offset - 2, point.y + 2);
        context.lineTo(point.x + offset - 10, point.y + 2);
        context.closePath();
        context.fill();
      }
      context.restore();
    });
  }

  function drawDestination(x, y, destinationName) {
    context.beginPath();
    context.arc(x, y, 23, 0, Math.PI * 2);
    context.fillStyle = 'rgba(203,7,11,.18)';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = '#cb070b';
    context.stroke();
    context.beginPath();
    context.arc(x, y, 11, 0, Math.PI * 2);
    context.fillStyle = '#fff';
    context.fill();
    context.fillStyle = '#cb070b';
    context.beginPath();
    context.arc(x, y, 5, 0, Math.PI * 2);
    context.fill();
    const label = 'DESTINO';
    context.font = 'bold 8px sans-serif';
    const labelWidth = 46;
    context.fillStyle = '#cb070b';
    context.fillRect(x - labelWidth / 2, y - 40, labelWidth, 17);
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, x, y - 31.5);
  }

  function drawStartMarker(x, y) {
    context.beginPath();
    context.arc(x, y, 25, 0, Math.PI * 2);
    context.setLineDash([4, 4]);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255,255,255,.8)';
    context.stroke();
    context.setLineDash([]);
  }

  function drawRobot(robot) {
    context.save();
    context.translate(robot.x, robot.y);
    context.fillStyle = 'rgba(0,0,0,.32)';
    context.beginPath();
    context.ellipse(0, 15, 19, 7, 0, 0, Math.PI * 2);
    context.fill();
    context.rotate(robot.direction * Math.PI / 180);
    context.fillStyle = '#262b2d';
    context.beginPath();
    context.roundRect(-19, -7, 7, 18, 3);
    context.roundRect(12, -7, 7, 18, 3);
    context.fill();
    context.fillStyle = '#cb070b';
    context.strokeStyle = '#cb070b';
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(-15, -16, 30, 31, 9);
    context.fill();
    context.stroke();
    context.fillStyle = '#17191c';
    context.beginPath();
    context.roundRect(-11, -11, 22, 15, 6);
    context.fill();
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(-5, -5, 2.6, 0, Math.PI * 2);
    context.arc(5, -5, 2.6, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#cb070b';
    context.beginPath();
    context.roundRect(-5, 1, 10, 2, 1);
    context.fill();
    context.fillStyle = '#cb070b';
    context.beginPath();
    context.roundRect(-10, 7, 20, 6, 3);
    context.fill();
    context.fillStyle = '#f4f1e8';
    context.fillRect(-6, 8, 3, 2);
    context.fillRect(-1, 8, 3, 2);
    context.fillRect(4, 8, 3, 2);
    context.beginPath();
    context.moveTo(0, -27);
    context.lineTo(7, -17);
    context.lineTo(0, -20);
    context.lineTo(-7, -17);
    context.closePath();
    context.fill();
    context.strokeStyle = '#cb070b';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#cb070b';
    context.beginPath();
    context.arc(0, -18, 2.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  global.ListenerGame = Object.freeze({
    init: initialize,
    resize: resizeCanvas,
    stopVoice,
    setPlayerProfile,
    startChallenge,
    resetChallenge,
    resetSession,
    validateChallenge: (challengeId, result) => challengeId === viewState.challengeId && result === viewState.lastExecution
      ? Missions.validatePedagogy(challengeId, viewState.program, result)
      : { valid: false, reason: 'A execução não corresponde ao desafio atual.' },
    getState: () => ({
      challengeId: viewState.challengeId,
      running: viewState.running,
      robot: viewState.mission ? { ...viewState.mission.robot } : null,
      execution: viewState.mission ? { ...viewState.mission.execution } : null,
      program: JSON.parse(JSON.stringify(viewState.program)),
      voiceScope: viewState.voiceScope ? {
        type: viewState.voiceScope.type,
        branch: viewState.voiceScope.branch || null
      } : null
    }),
    getChallenges: () => CHALLENGES,
    addCommand,
    processVoiceTranscript: handleVoiceTranscript
  });
})(window);
