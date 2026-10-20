/* The game remains an internal screen of the entry application, never an embedded second app. */
(function () {
  const splash = document.getElementById('splash');
  const header = document.getElementById('siteHeader');
  const pages = [...document.querySelectorAll('[data-page]')];
  const PROGRESS_KEY = 'listener:foundations:v2';
  const SETTINGS_KEY = 'listener:settings:v1';
  const PENDING_SUBMISSIONS_KEY = 'listener:pending-session-submissions:v1';
  const Learning = window.ListenerLearning;
  const SessionStore = window.ListenerSessionStore;
  const ACCESS_SOURCES = [
    { value: 'school', label: 'Escola' },
    { value: 'event', label: 'Evento' },
    { value: 'robotics-team', label: 'Equipe de robótica' },
    { value: 'recommendation', label: 'Indicação' },
    { value: 'other', label: 'Outro' },
  ];
  const FOUNDATIONS = [
    { key: 'sequencing', label: 'Sequenciamento', challengeIds: ['sequencing-1', 'sequencing-2'] },
    { key: 'repetition', label: 'Repetição', challengeIds: ['repetition-1', 'repetition-2'] },
    { key: 'conditionals', label: 'Condicionais', challengeIds: ['conditionals-1', 'conditionals-2'] },
  ];
  const CHALLENGE_IDS = FOUNDATIONS.flatMap((foundation) => foundation.challengeIds);
  const playerForm = document.getElementById('playerForm');
  const sourceSelect = document.getElementById('accessSource');
  const otherSourceField = document.getElementById('otherSourceField');
  const state = {
    session: null,
    learning: loadLearning(),
    completedChallenges: null,
    settings: loadSettings(),
    currentScreen: 'home',
    currentFoundation: null,
    currentChallengeId: null,
    assessment: null,
    pendingRegistration: null,
  };
  state.completedChallenges = state.learning.completedChallenges;
  let splashTimer;
  let splashFinishTimer;
  let questionnaireSubmitting = false;
  let audioContext = null;

  function isTrackComplete() {
    return !!state.session && SessionStore.trackIsComplete(state.completedChallenges, CHALLENGE_IDS);
  }

  function showPage(name) {
    if (name === 'completion' && !isTrackComplete()) return false;
    if (isTrackComplete() && !['completion', 'game'].includes(name)) return false;
    const previousScreen = state.currentScreen;
    if (previousScreen === 'game' && name !== 'game' && window.ListenerGame?.getState().running) {
      const feedback = document.getElementById('gameFeedback');
      feedback.textContent = 'Interrompa a execução antes de sair do desafio; o mapa permanece visível enquanto o Listener se move.';
      feedback.dataset.state = 'invalid';
      return false;
    }
    pages.forEach((page) => { page.hidden = page.dataset.page !== name; });
    state.currentScreen = name;
    header.hidden = false;
    document.body.classList.toggle('game-open', name === 'game');
    if (previousScreen === 'game' && name !== 'game') window.ListenerGame?.stopVoice();
    if (name === 'performance') renderPerformance();
    if (name === 'settings') renderSettings();
    if (name === 'completion') document.getElementById('navigationMenuToggle').hidden = true;
    renderNavigation();
    if (name === 'game') window.ListenerGame?.resize?.();
    window.scrollTo(0, 0);
    return true;
  }

  function finishSplash() {
    if (!splash || splash.classList.contains('is-leaving')) return;
    clearTimeout(splashTimer);
    clearTimeout(splashFinishTimer);
    splash.classList.add('is-leaving');
    splashFinishTimer = window.setTimeout(() => {
      splash.hidden = true;
      header.hidden = false;
      if (state.currentScreen === 'home') showPage('home');
    }, 240);
  }

  function loadLearning() {
    try {
      const stored = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      return Learning.createState(CHALLENGE_IDS, stored);
    } catch (_) {
      return Learning.createState(CHALLENGE_IDS);
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(Learning.toStorage(state.learning)));
      return true;
    } catch (_) {
      return false;
    }
  }

  function readPendingSubmissions() {
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_SUBMISSIONS_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((item) => item && item.session?.id && item.completion) : [];
    } catch (_) {
      updatePendingNotice('Não foi possível ler os envios pendentes deste dispositivo. Não limpe os dados do navegador; procure a equipe responsável.');
      return null;
    }
  }

  function updatePendingNotice(message) {
    const notice = document.getElementById('pendingSubmissionNotice');
    if (!notice) return;
    notice.textContent = message || '';
    notice.hidden = !message;
  }

  function savePendingSubmissions(items) {
    try {
      localStorage.setItem(PENDING_SUBMISSIONS_KEY, JSON.stringify(items));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removePendingSubmission(sessionId) {
    const current = readPendingSubmissions();
    if (!current) return false;
    const pending = current.filter((item) => item.session.id !== sessionId);
    return savePendingSubmissions(pending);
  }

  async function sendPendingSubmission(item) {
    if (!item.registered) {
      await SessionStore.registerSession(item.session);
      item.registered = true;
      const current = readPendingSubmissions();
      if (!current) throw new Error('Não foi possível ler a fila local de avaliações pendentes.');
      const pending = current.filter((entry) => entry.session.id !== item.session.id);
      pending.push(item);
      if (!savePendingSubmissions(pending)) {
        throw new Error('A sessão foi registrada, mas não foi possível preservar a tentativa de avaliação. Tente novamente.');
      }
    }
    await SessionStore.completeSession(item.session, item.completion);
    const current = readPendingSubmissions();
    if (!current) throw new Error('Não foi possível ler a fila local de avaliações pendentes.');
    const remaining = current.filter((entry) => entry.session.id !== item.session.id);
    if (!savePendingSubmissions(remaining)) {
      throw new Error('O serviço confirmou a avaliação, mas não foi possível atualizar a fila local de envios.');
    }
  }

  async function flushPendingSubmissions() {
    const pending = readPendingSubmissions();
    if (!pending) return;
    if (!SessionStore.endpoint()) {
      updatePendingNotice(pending.length
        ? `${pending.length} avaliação(ões) ainda não enviada(s). Configure o serviço de armazenamento para tentar o envio; os dados permanecem neste dispositivo.`
        : '');
      return;
    }
    let failure = null;
    for (const item of pending) {
      try {
        await sendPendingSubmission(item);
      } catch (error) {
        failure = error;
      }
    }
    const remaining = readPendingSubmissions();
    updatePendingNotice(remaining?.length
      ? `Não foi possível enviar ${remaining.length} avaliação(ões) pendente(s): ${failure?.message || 'o serviço não confirmou a gravação'}. Os dados permanecem neste dispositivo.`
      : '');
  }

  function loadSettings() {
    const defaults = { readAloud: false, soundEffects: false, volume: 40, highContrast: false, reducedMotion: false };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        readAloud: saved.readAloud === true,
        soundEffects: saved.soundEffects === true,
        volume: Number.isFinite(Number(saved.volume)) ? Math.max(0, Math.min(100, Number(saved.volume))) : defaults.volume,
        highContrast: saved.highContrast === true,
        reducedMotion: saved.reducedMotion === true
      };
    } catch (_) {
      return defaults;
    }
  }

  function saveSettings() {
    applySettings();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      document.getElementById('settingsStatus').textContent = 'Preferências salvas neste navegador.';
    } catch (_) {
      document.getElementById('settingsStatus').textContent = 'Não foi possível salvar; as preferências continuam nesta sessão.';
    }
  }

  function applySettings() {
    document.body.classList.toggle('high-contrast', state.settings.highContrast);
    document.body.classList.toggle('reduce-motion', state.settings.reducedMotion);
  }

  function renderSettings() {
    document.getElementById('settingReadAloud').checked = state.settings.readAloud;
    document.getElementById('settingSound').checked = state.settings.soundEffects;
    document.getElementById('settingVolume').value = String(state.settings.volume);
    document.getElementById('volumeValue').textContent = `${state.settings.volume}%`;
    document.getElementById('settingHighContrast').checked = state.settings.highContrast;
    document.getElementById('settingReducedMotion').checked = state.settings.reducedMotion;
    if (state.settings.readAloud && !('speechSynthesis' in window)) {
      document.getElementById('speechStatus').textContent = 'Síntese de fala não disponível neste navegador.';
    }
    if (state.settings.soundEffects && !(window.AudioContext || window.webkitAudioContext)) {
      document.getElementById('settingsStatus').textContent = 'Efeitos sonoros não disponíveis neste navegador.';
    }
  }

  function renderPerformance() {
    const summary = Learning.progress(state.learning, FOUNDATIONS);
    const container = document.getElementById('performanceSummary');
    container.replaceChildren();
    [
      ['Pontuação acumulada', `${summary.score} pontos`],
      ['Desafios concluídos', `${summary.completed} de ${summary.total}`],
      ['Fundamento atual', summary.currentFoundation || 'Trilha concluída'],
      ['Progresso da trilha', `${summary.completed} de ${summary.total} (${Math.round(summary.completed / summary.total * 100)}%)`]
    ].forEach(([label, value]) => {
      const item = document.createElement('article');
      item.className = 'performance-metric';
      const heading = document.createElement('h2');
      heading.textContent = label;
      const result = document.createElement('p');
      result.textContent = value;
      item.append(heading, result);
      container.append(item);
    });

    const achievements = document.getElementById('achievementList');
    achievements.replaceChildren();
    if (!summary.achievements.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Conclua desafios para atingir metas de aprendizagem.';
      achievements.append(empty);
    } else {
      summary.achievements.forEach((achievement) => {
        const item = document.createElement('li');
        item.textContent = achievement.title;
        achievements.append(item);
      });
    }

    const history = document.getElementById('learningHistory');
    history.replaceChildren();
    [...state.learning.history].reverse().forEach((entry) => {
      const item = document.createElement('li');
      const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.at));
      if (entry.type === 'challenge-completed') {
        const challenge = window.ListenerMissions.CHALLENGES[entry.challengeId];
        item.textContent = `${date} — ${challenge?.title || 'Desafio concluído'}: ${entry.points} pontos.`;
      } else {
        item.textContent = `${date} — Meta atingida: ${entry.title}.`;
      }
      history.append(item);
    });
    if (!history.children.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Suas conquistas validadas aparecerão aqui.';
      history.append(empty);
    }
    renderNavigation();
  }

  function renderNavigation() {
    const available = !!state.session && state.currentScreen !== 'completion' && !isTrackComplete();
    document.getElementById('navigationMenuToggle').hidden = !available;
    const hasActiveChallenge = !!state.currentChallengeId &&
      !state.completedChallenges[state.currentChallengeId] &&
      !!window.ListenerGame?.getState().challengeId;
    document.getElementById('resumeMenuChallenge').hidden = !hasActiveChallenge;
    document.getElementById('resumeTrailChallenge').hidden = !hasActiveChallenge;
    document.getElementById('resumePerformanceChallenge').hidden = !hasActiveChallenge;
  }

  function setMenuOpen(open) {
    const drawer = document.getElementById('navigationDrawer');
    const scrim = document.getElementById('navigationScrim');
    const trigger = document.getElementById('navigationMenuToggle');
    drawer.hidden = !open;
    scrim.hidden = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    if (open) drawer.querySelector('button:not([hidden])')?.focus();
    else trigger.focus();
  }

  function containMenuFocus(event) {
    const drawer = document.getElementById('navigationDrawer');
    if (drawer.hidden || event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('button:not([disabled]):not([hidden]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function navigateFromMenu(name) {
    setMenuOpen(false);
    if (name === 'game') {
      if (state.currentChallengeId && window.ListenerGame?.getState().challengeId === state.currentChallengeId) showPage('game');
      return;
    }
    if (name === 'trail') renderTrail();
    if (name === 'performance') renderPerformance();
    showPage(name);
  }

  function useHint(challengeId) {
    if (!state.session || challengeId !== state.currentChallengeId) {
      return { accepted: false, reason: 'Abra o desafio atual para consultar uma dica.' };
    }
    const challenge = window.ListenerMissions.CHALLENGES[challengeId];
    const result = Learning.useHint(state.learning, challengeId, state.session.player.age);
    if (!result.accepted) return result;
    if (!saveProgress()) {
      state.learning.hintReveals[challengeId] -= 1;
      return { accepted: false, reason: 'Não foi possível salvar o uso da dica. Tente novamente.' };
    }
    const hintList = challenge.hints[state.session.profile.key === 'young' ? 'young' : 'mature'];
    return { ...result, text: hintList[result.reveal - 1] };
  }

  function speakText(text, force = false) {
    if (!force && !state.settings.readAloud) return false;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      document.getElementById('speechStatus').textContent = 'Síntese de fala não disponível neste navegador.';
      return false;
    }
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(String(text));
    utterance.lang = 'pt-BR';
    utterance.onerror = () => {
      document.getElementById('speechStatus').textContent = 'Não foi possível iniciar a leitura em voz alta.';
    };
    window.speechSynthesis.speak(utterance);
    document.getElementById('speechStatus').textContent = 'Leitura em voz alta em andamento.';
    return true;
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    document.getElementById('speechStatus').textContent = 'Leitura interrompida.';
  }

  function playSound(kind) {
    if (!state.settings.soundEffects || state.settings.volume === 0) return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    audioContext ||= new AudioContextClass();
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {
        document.getElementById('settingsStatus').textContent = 'O navegador bloqueou a reprodução de áudio.';
      });
    }
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    const frequency = kind === 'success' ? 660 : kind === 'error' ? 220 : 440;
    gain.gain.setValueAtTime(state.settings.volume / 100 * 0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.12);
    return true;
  }

  function getProfile(age) {
    if (age >= 6 && age <= 11) {
      return {
        key: 'young', ageBand: '6–11 anos', language: 'simple', visualTone: 'playful',
        hints: { enabled: true, availability: 'available', scoring: 'no-penalty' },
        readAloud: { enabled: state.settings.readAloud, availability: 'available' },
      };
    }
    if (age >= 12) {
      return {
        key: '12-plus', ageBand: '12 anos ou mais', language: 'objective', visualTone: 'professional',
        hints: { enabled: true, availability: 'available', scoring: 'penalty' },
        readAloud: { enabled: state.settings.readAloud, availability: 'available' },
      };
    }
    return null;
  }

  function validatePlayer(values) {
    const errors = {};
    const name = String(values.name || '').trim();
    const rawAge = String(values.age ?? '').trim();
    const age = Number(rawAge);
    const allowedSources = new Set(ACCESS_SOURCES.map((source) => source.value));
    if (!name) errors.name = 'Informe seu nome.';
    if (!rawAge) errors.age = 'Informe sua idade.';
    else if (!Number.isInteger(age) || age < 1 || age > 120) errors.age = 'Informe uma idade inteira entre 1 e 120 anos.';
    else if (age < 6) errors.age = 'O Listener foi concebido para pessoas a partir de 6 anos.';
    if (!allowedSources.has(values.accessSource)) errors.accessSource = 'Selecione como conheceu ou acessou o jogo.';
    if (values.accessSource === 'other' && !String(values.accessDetail || '').trim()) {
      errors.accessDetail = 'Conte brevemente como conheceu ou acessou o jogo.';
    }
    return { valid: Object.keys(errors).length === 0, errors, age, name };
  }

  function foundationIsUnlocked(index) {
    if (index === 0) return true;
    return FOUNDATIONS[index - 1].challengeIds.every((id) => state.completedChallenges[id]);
  }

  function getProgrammingCapabilities(challengeId) {
    if (!state.session) return null;
    const index = FOUNDATIONS.findIndex((foundation) => foundation.challengeIds.includes(challengeId));
    if (index < 0 || !foundationIsUnlocked(index) ||
        nextChallenge(FOUNDATIONS[index]) !== challengeId) return null;
    return Object.freeze({
      challengeId,
      foundation: FOUNDATIONS[index].key,
      allowRepeat: index >= 1,
      allowConditionals: index >= 2,
    });
  }

  function nextChallenge(foundation) {
    return foundation.challengeIds.find((id) => !state.completedChallenges[id]) || null;
  }

  function renderTrail() {
    const trail = document.getElementById('page-trail');
    const profile = state.session.profile;
    trail.dataset.profile = profile.key;
    const summary = document.getElementById('profileSummary');
    summary.replaceChildren();

    const welcome = document.createElement('p');
    welcome.className = 'profile-welcome';
    welcome.textContent = profile.key === 'young' ? `Vamos nessa, ${state.session.player.name}!` : `Jornada de ${state.session.player.name}`;
    const description = document.createElement('p');
    description.className = 'profile-description';
    description.textContent = profile.key === 'young'
      ? 'Conclua os desafios em ordem para liberar novos fundamentos.'
      : 'Cada fundamento tem dois desafios que precisam ser concluídos em ordem.';
    const planned = document.createElement('p');
    planned.className = 'profile-planned';
    planned.textContent = profile.key === 'young'
      ? 'Use os blocos para planejar, testar e melhorar seu programa.'
      : 'O progresso é salvo ao cumprir o objetivo e o conceito de cada missão.';
    summary.append(welcome, description, planned);

    FOUNDATIONS.forEach((foundation, index) => {
      const node = document.querySelector(`[data-foundation-node="${foundation.key}"]`);
      const button = node.querySelector('.foundation-button');
      const unlocked = foundationIsUnlocked(index);
      const doneCount = foundation.challengeIds.filter((id) => state.completedChallenges[id]).length;
      const complete = doneCount === foundation.challengeIds.length;
      node.classList.toggle('is-unlocked', unlocked);
      node.classList.toggle('is-locked', !unlocked);
      node.classList.toggle('is-complete', complete);
      button.disabled = !unlocked;
      const challengeCount = foundation.challengeIds.length;
      const challengeNoun = challengeCount === 1 ? 'desafio' : 'desafios';
      const completionNoun = doneCount === 1 ? 'concluído' : 'concluídos';
      const status = complete ? 'concluído' : unlocked ? 'liberado' : 'bloqueado';
      button.setAttribute('aria-label', `${foundation.label}, ${status}, ${doneCount} de ${challengeCount} ${challengeNoun} ${completionNoun}`);
      node.querySelector('.foundation-state').textContent = complete ? 'Concluído' : unlocked ? 'Liberado' : 'Bloqueado';
      node.querySelector(`[data-progress-label="${foundation.key}"]`).textContent = `${doneCount} de ${challengeCount} ${challengeNoun}`;
      foundation.challengeIds.forEach((id) => {
        node.querySelector(`[data-challenge="${id}"]`).classList.toggle('is-complete', state.completedChallenges[id]);
      });
    });
    const allComplete = FOUNDATIONS.every((foundation) =>
      foundation.challengeIds.every((id) => state.completedChallenges[id]));
    document.getElementById('trailStatus').textContent = allComplete
      ? 'Trilha concluída.'
      : 'Conclua os desafios em ordem para liberar o próximo fundamento.';
    const resumeButton = document.getElementById('resumeTrailChallenge');
    if (!resumeButton.hidden) {
      resumeButton.textContent = `Retomar: ${window.ListenerMissions.CHALLENGES[state.currentChallengeId].title}`;
    }
    renderNavigation();
  }

  function clearErrors() {
    playerForm.querySelectorAll('.field-error').forEach((element) => { element.textContent = ''; });
    playerForm.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
    document.getElementById('formNotice').textContent = '';
  }

  function showErrors(errors) {
    const fieldIds = { name: 'playerName', age: 'playerAge', accessSource: 'accessSource', accessDetail: 'accessDetail' };
    clearErrors();
    Object.entries(errors).forEach(([key, message]) => {
      const field = document.getElementById(fieldIds[key]);
      document.getElementById(`${fieldIds[key]}Error`).textContent = message;
      field.setAttribute('aria-invalid', 'true');
    });
    if (errors.age?.includes('a partir de 6')) document.getElementById('formNotice').textContent = errors.age;
    document.getElementById(fieldIds[Object.keys(errors)[0]])?.focus();
  }

  function beginQuestionnaire() {
    if (state.currentChallengeId && !state.completedChallenges[state.currentChallengeId]) {
      window.ListenerGame?.resetChallenge();
    }
    state.session = null;
    playerForm.reset();
    clearErrors();
    otherSourceField.hidden = true;
    document.getElementById('accessDetail').required = false;
    showPage('questionnaire');
    document.getElementById('playerName').focus();
  }

  function submitQuestionnaire(event) {
    event.preventDefault();
    if (questionnaireSubmitting) return;
    const values = Object.fromEntries(new FormData(playerForm).entries());
    const result = validatePlayer(values);
    if (!result.valid) {
      showErrors(result.errors);
      return;
    }

    const participant = {
      name: result.name,
      age: result.age,
      access: { source: values.accessSource, detail: values.accessSource === 'other' ? String(values.accessDetail).trim() : '' },
    };
    const previousLearning = SessionStore.trackIsComplete(state.completedChallenges, CHALLENGE_IDS)
      ? state.learning
      : null;
    if (previousLearning) {
      state.learning = Learning.createState(CHALLENGE_IDS);
      state.completedChallenges = state.learning.completedChallenges;
      if (!saveProgress()) {
        state.learning = previousLearning;
        state.completedChallenges = previousLearning.completedChallenges;
        document.getElementById('formNotice').textContent =
          'Não foi possível iniciar uma nova trilha sem misturar o progresso concluído anteriormente. Confira o armazenamento do navegador e tente novamente.';
        return;
      }
    }
    if (!state.pendingRegistration || JSON.stringify(state.pendingRegistration.player) !== JSON.stringify(participant)) {
      state.pendingRegistration = {
        id: SessionStore.createSessionId(),
        startedAt: new Date().toISOString(),
        player: participant
      };
    }
    const session = {
      ...state.pendingRegistration,
      player: participant,
      profile: getProfile(result.age),
      registered: false
    };
    const submitButton = playerForm.querySelector('[type="submit"]');
    questionnaireSubmitting = true;
    submitButton.disabled = true;
    document.getElementById('formNotice').textContent = 'Preparando sua sessão…';
    Promise.resolve(SessionStore.endpoint() ? SessionStore.registerSession(session) : { configured: false, confirmed: false })
      .then((registration) => {
        session.registered = Boolean(registration?.confirmed);
        state.session = session;
        state.assessment = null;
        state.pendingRegistration = null;
        clearErrors();
        renderTrail();
        showPage('trail');
        const trailNotices = [];
        if (previousLearning) {
          trailNotices.push('A trilha anterior já concluída foi reiniciada para começar esta sessão do zero.');
        }
        if (!registration?.configured || !registration?.confirmed) {
          trailNotices.push('A integração de armazenamento está indisponível no momento. A sessão continua localmente e a avaliação final será preservada neste dispositivo.');
        }
        if (trailNotices.length) document.getElementById('trailStatus').textContent = trailNotices.join(' ');
      })
      .catch((error) => {
        session.registered = false;
        state.session = session;
        state.assessment = null;
        state.pendingRegistration = null;
        clearErrors();
        renderTrail();
        showPage('trail');
        document.getElementById('trailStatus').textContent =
          `A sessão foi iniciada localmente, mas o serviço de armazenamento está indisponível: ${error.message || 'falha de conexão'}. A avaliação final será salva neste dispositivo até a conexão voltar.`;
      })
      .finally(() => {
        questionnaireSubmitting = false;
        submitButton.disabled = false;
      });
  }

  function requestChallenge(foundationKey) {
    const index = FOUNDATIONS.findIndex((foundation) => foundation.key === foundationKey);
    if (index < 0 || !foundationIsUnlocked(index) || !state.session) return;
    const foundation = FOUNDATIONS[index];
    const challengeId = nextChallenge(foundation);
    if (!challengeId) {
      document.getElementById('trailStatus').textContent = `Os desafios de ${foundation.label} já foram concluídos.`;
      return;
    }
    if (!startChallenge(challengeId, foundationKey)) {
      document.getElementById('trailStatus').textContent = 'Não foi possível iniciar o desafio. Atualize a página e tente novamente.';
    }
  }

  function startChallenge(challengeId, foundationKey) {
    const foundation = FOUNDATIONS.find((item) => item.challengeIds.includes(challengeId));
    if (!foundation || !state.session) return false;
    const index = FOUNDATIONS.indexOf(foundation);
    if (!foundationIsUnlocked(index) || nextChallenge(foundation) !== challengeId) return false;
    if (state.currentChallengeId === challengeId && window.ListenerGame?.getState().challengeId === challengeId) {
      window.ListenerGame.setPlayerProfile(state.session.player.age);
      showPage('game');
      return true;
    }
    if (!window.ListenerGame?.startChallenge(challengeId)) return false;
    state.currentFoundation = foundationKey || foundation.key;
    state.currentChallengeId = challengeId;
    showPage('game');
    renderNavigation();
    return true;
  }

  function returnToTrail() {
    window.ListenerGame?.stopVoice();
    renderTrail();
    showPage('trail');
  }

  function completeChallenge(challengeId, result) {
    const index = FOUNDATIONS.findIndex((foundation) => foundation.challengeIds.includes(challengeId));
    if (!state.session || index < 0 || result?.valid !== true || result?.result !== 'complete' || result?.reached !== true) {
      return { accepted: false, nextChallengeId: null };
    }
    const foundation = FOUNDATIONS[index];
    if (state.completedChallenges[challengeId]) return { accepted: false, alreadyCompleted: true, nextChallengeId: null };
    const pedagogy = window.ListenerGame?.validateChallenge(challengeId, result);
    if (pedagogy?.valid !== true) return { accepted: false, nextChallengeId: null, reason: pedagogy?.reason };
    if (!foundationIsUnlocked(index) || nextChallenge(foundation) !== challengeId) {
      return { accepted: false, nextChallengeId: null, reason: 'Conclua primeiro os desafios anteriores desta trilha.' };
    }
    const reward = Learning.awardCompletion(
      state.learning,
      window.ListenerMissions.CHALLENGES[challengeId],
      result,
      pedagogy,
      state.session.player.age,
      FOUNDATIONS
    );
    if (!reward.accepted) return { accepted: false, nextChallengeId: null, reason: reward.reason };
    const saved = saveProgress();
    renderTrail();
    renderPerformance();
    if (!saved) document.getElementById('trailStatus').textContent = 'O progresso vale nesta sessão, mas não pôde ser salvo neste navegador.';
    const nextInFoundation = nextChallenge(foundation);
    const nextFoundation = FOUNDATIONS[index + 1];
    const nextChallengeId = nextInFoundation || (nextFoundation && foundationIsUnlocked(index + 1) ? nextChallenge(nextFoundation) : null);
    const foundationCompleted = !nextInFoundation;
    return {
      accepted: true,
      nextChallengeId,
      foundationCompleted,
      completedFoundation: foundationCompleted ? foundation.key : null,
      nextFoundation: foundationCompleted ? nextFoundation?.key || null : null,
      allComplete: isTrackComplete(),
      ageBand: state.session.player.age <= 11 ? 'young' : '12-plus',
      points: reward.points,
      hintPenalty: reward.penalty,
      hintsUsed: reward.hints,
      progressSaved: saved
    };
  }

  function setFeedbackStatus(message, status = 'waiting') {
    const element = document.getElementById('feedbackStorageStatus');
    element.textContent = message;
    element.dataset.state = status;
  }

  function openExperienceCompletion() {
    if (!isTrackComplete()) return false;
    state.assessment = { rating: '', comment: '', submitted: false, confirmed: false, queued: false };
    document.getElementById('congratulationsStep').hidden = false;
    document.getElementById('experienceFeedbackStep').hidden = true;
    document.getElementById('experienceFeedbackForm').reset();
    document.querySelectorAll('#experienceFeedbackForm input, #experienceFeedbackForm textarea')
      .forEach((field) => { field.disabled = false; });
    document.getElementById('finishSession').disabled = true;
    document.getElementById('submitExperienceFeedback').disabled = false;
    document.getElementById('submitExperienceFeedback').textContent = 'Enviar avaliação';
    document.getElementById('feedbackStorageStatus').textContent = '';
    document.getElementById('feedbackStorageStatus').dataset.state = '';
    document.getElementById('feedbackIntegrationNote').textContent = SessionStore.endpoint()
      ? ''
      : 'A integração com a planilha não está configurada. Sem um endpoint, a avaliação ficará marcada como pendente neste dispositivo e não será apresentada como enviada.';
    document.getElementById('finalScore').textContent =
      `Você concluiu 6 de 6 desafios e conquistou ${Learning.progress(state.learning, FOUNDATIONS).score} pontos.`;
    return showPage('completion');
  }

  function buildCompletionRecord() {
    const comment = document.getElementById('experienceComment').value.trim();
    return {
      rating: document.querySelector('[name="experienceRating"]:checked')?.value || '',
      comment,
      completedAt: new Date().toISOString(),
      track: {
        status: 'complete',
        completedChallenges: Learning.progress(state.learning, FOUNDATIONS).completed,
        score: Learning.progress(state.learning, FOUNDATIONS).score
      }
    };
  }

  function makePendingSubmission(completion) {
    return {
      session: {
        id: state.session.id,
        startedAt: state.session.startedAt,
        player: state.session.player
      },
      registered: state.session.registered,
      completion
    };
  }

  function clearQueuedAssessment() {
    if (!state.session) return true;
    const saved = removePendingSubmission(state.session.id);
    if (!saved) setFeedbackStatus('Não foi possível atualizar o envio pendente neste dispositivo.', 'error');
    return saved;
  }

  async function submitExperienceFeedback(event) {
    event.preventDefault();
    if (!isTrackComplete() || !state.assessment) return;
    const currentRating = document.querySelector('[name="experienceRating"]:checked')?.value || '';
    const currentComment = document.getElementById('experienceComment').value.trim();
    const reuseCompletion = state.assessment.submitted &&
      state.assessment.rating === currentRating && state.assessment.comment === currentComment;
    const completion = reuseCompletion ? state.assessment.completion : buildCompletionRecord();
    if (!['good', 'very-good', 'excellent'].includes(completion.rating)) {
      setFeedbackStatus('Escolha Bom, Muito bom ou Excelente para continuar.', 'error');
      document.querySelector('[name="experienceRating"]')?.focus();
      return;
    }
    if (state.assessment.confirmed) return;

    const submitButton = document.getElementById('submitExperienceFeedback');
    const finishButton = document.getElementById('finishSession');
    submitButton.disabled = true;
    finishButton.disabled = true;
    submitButton.textContent = 'Enviando…';
    state.assessment.rating = completion.rating;
    state.assessment.comment = completion.comment;
    state.assessment.completion = completion;
    state.assessment.submitted = true;
    state.assessment.queued = false;
    const pending = makePendingSubmission(completion);

    if (!SessionStore.endpoint()) {
      const storedItems = readPendingSubmissions();
      if (!storedItems) {
        setFeedbackStatus('Não foi possível ler os envios pendentes. Os dados desta avaliação continuam nesta tela.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Tentar novamente';
        return;
      }
      const items = storedItems.filter((item) => item.session.id !== pending.session.id);
      items.push(pending);
      if (!savePendingSubmissions(items)) {
        setFeedbackStatus('Não foi possível preservar a avaliação neste dispositivo. Seus dados continuam nesta tela; tente novamente.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Tentar novamente';
        return;
      }
      state.assessment.queued = true;
      const pendingCount = readPendingSubmissions()?.length;
      updatePendingNotice(`${pendingCount ?? 1} avaliação(ões) ainda não enviada(s). Configure o serviço de armazenamento; os dados permanecem neste dispositivo.`);
      finishButton.disabled = false;
      setFeedbackStatus('Avaliação ainda não enviada: a integração não está configurada. Os dados foram preservados neste dispositivo; a sessão pode ser finalizada sem confirmação externa.', 'error');
      submitButton.disabled = false;
      submitButton.textContent = 'Tentar novamente';
      return;
    }

    try {
      if (!state.session.registered) {
        await SessionStore.registerSession(state.session);
        state.session.registered = true;
      }
      await SessionStore.completeSession(state.session, completion);
      const localQueueCleared = removePendingSubmission(state.session.id);
      const remaining = readPendingSubmissions();
      if (remaining) {
        updatePendingNotice(remaining.length
          ? 'Há avaliações anteriores pendentes neste dispositivo; elas ainda não foram enviadas.'
          : '');
      }
      state.assessment.confirmed = true;
      document.querySelectorAll('#experienceFeedbackForm input, #experienceFeedbackForm textarea')
        .forEach((field) => { field.disabled = true; });
      finishButton.disabled = false;
      submitButton.textContent = 'Avaliação registrada';
      setFeedbackStatus(
        localQueueCleared
          ? 'Avaliação registrada e confirmada pelo serviço. Você já pode finalizar a sessão.'
          : 'O serviço confirmou a avaliação. A fila local não pôde ser atualizada; uma nova tentativa será idempotente.',
        'confirmed'
      );
    } catch (error) {
      const storedItems = readPendingSubmissions();
      const items = storedItems?.filter((item) => item.session.id !== pending.session.id) || [];
      items.push(pending);
      const preserved = !!storedItems && savePendingSubmissions(items);
      state.assessment.queued = preserved;
      if (preserved) updatePendingNotice('Uma avaliação ainda aguarda envio confirmado. Os dados ficam preservados neste dispositivo.');
      setFeedbackStatus(
        preserved
          ? `Não foi possível confirmar o registro: ${error.message} Seus dados foram preservados; verifique a conexão e tente novamente.`
          : `Não foi possível confirmar nem preservar o registro: ${error.message} Mantenha esta tela aberta e tente novamente.`,
        'error'
      );
      submitButton.disabled = false;
      submitButton.textContent = 'Tentar novamente';
    }
  }

  function assessmentChanged() {
    if (!state.assessment || state.assessment.confirmed || !state.assessment.submitted) return;
    if (!clearQueuedAssessment()) return;
    state.assessment.submitted = false;
    state.assessment.queued = false;
    state.assessment.rating = '';
    state.assessment.comment = '';
    document.getElementById('finishSession').disabled = true;
    document.getElementById('submitExperienceFeedback').textContent = 'Enviar avaliação';
    document.getElementById('submitExperienceFeedback').disabled = false;
    setFeedbackStatus('Resposta atualizada. Envie a avaliação novamente.', 'waiting');
  }

  function resetSession() {
    try {
      localStorage.removeItem(PROGRESS_KEY);
      if (localStorage.getItem(PROGRESS_KEY) !== null) throw new Error('O progresso anterior continua no armazenamento local.');
    } catch (_) {
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(Learning.toStorage(Learning.createState(CHALLENGE_IDS))));
      } catch (_) {
        document.getElementById('feedbackStorageStatus').textContent =
          'Não foi possível limpar o progresso anterior. A sessão continua aberta para evitar misturar participantes.';
        document.getElementById('feedbackStorageStatus').dataset.state = 'error';
        return false;
      }
    }

    clearTimeout(splashTimer);
    clearTimeout(splashFinishTimer);
    window.ListenerGame?.resetSession();
    window.ListenerGame?.stopVoice();
    stopSpeech();
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (!document.getElementById('navigationDrawer').hidden) setMenuOpen(false);
    state.session = null;
    state.learning = Learning.createState(CHALLENGE_IDS);
    state.completedChallenges = state.learning.completedChallenges;
    state.currentFoundation = null;
    state.currentChallengeId = null;
    state.assessment = null;
    state.pendingRegistration = null;
    playerForm.reset();
    clearErrors();
    document.getElementById('experienceFeedbackForm').reset();
    document.getElementById('feedbackStorageStatus').textContent = '';
    document.getElementById('feedbackIntegrationNote').textContent = '';
    document.getElementById('otherSourceField').hidden = true;
    document.getElementById('accessDetail').required = false;
    document.getElementById('navigationMenuToggle').hidden = true;
    document.body.classList.remove('game-open');
    document.querySelectorAll('[data-page]').forEach((page) => { page.hidden = page.dataset.page !== 'home'; });
    state.currentScreen = 'home';
    header.hidden = true;
    splash.classList.remove('is-leaving');
    splash.hidden = false;
    window.scrollTo(0, 0);
    splashTimer = window.setTimeout(finishSplash, 620);
    return true;
  }

  function finishExperienceSession() {
    if (!isTrackComplete() || !state.assessment?.rating || !state.assessment.submitted) return false;
    if (!state.assessment.confirmed && !state.assessment.queued) return false;
    return resetSession();
  }

  ACCESS_SOURCES.forEach((source) => {
    const option = document.createElement('option');
    option.value = source.value;
    option.textContent = source.label;
    sourceSelect.append(option);
  });

  sourceSelect.addEventListener('change', () => {
    const isOther = sourceSelect.value === 'other';
    otherSourceField.hidden = !isOther;
    document.getElementById('accessDetail').required = isOther;
    if (isOther) document.getElementById('accessDetail').focus();
    clearErrors();
  });
  playerForm.addEventListener('input', (event) => {
    const field = event.target;
    if (field.matches('input, select') && field.hasAttribute('aria-invalid')) {
      field.removeAttribute('aria-invalid');
      const errorId = field.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('Error'));
      if (errorId) document.getElementById(errorId).textContent = '';
    }
  });
  playerForm.addEventListener('submit', submitQuestionnaire);
  document.getElementById('continueToFeedback').addEventListener('click', () => {
    if (!isTrackComplete() || !state.assessment) return;
    document.getElementById('congratulationsStep').hidden = true;
    document.getElementById('experienceFeedbackStep').hidden = false;
    document.querySelector('[name="experienceRating"]')?.focus();
  });
  document.getElementById('experienceFeedbackForm').addEventListener('submit', submitExperienceFeedback);
  document.querySelectorAll('[name="experienceRating"]').forEach((input) =>
    input.addEventListener('change', assessmentChanged));
  document.getElementById('experienceComment').addEventListener('input', assessmentChanged);
  document.getElementById('finishSession').addEventListener('click', () => {
    if (!finishExperienceSession()) {
      setFeedbackStatus('A sessão só pode ser finalizada depois de concluir a trilha, escolher uma avaliação e preservar ou confirmar o registro.', 'error');
    }
  });
  document.getElementById('editPlayerButton').addEventListener('click', () => showPage('questionnaire'));
  document.querySelectorAll('[data-foundation]').forEach((button) => {
    button.addEventListener('click', () => requestChallenge(button.dataset.foundation));
  });
  document.getElementById('returnToTrail').addEventListener('click', returnToTrail);
  window.ListenerGame?.init();
  window.ListenerApp = Object.freeze({
    getState: () => ({
      currentScreen: state.currentScreen,
      session: state.session,
      currentFoundation: state.currentFoundation,
      currentChallengeId: state.currentChallengeId,
      completedChallenges: { ...state.completedChallenges },
      performance: Learning.progress(state.learning, FOUNDATIONS),
      game: window.ListenerGame?.getState() || null,
    }),
    startChallenge,
    completeChallenge,
    getProgrammingCapabilities,
    openExperienceCompletion,
    finishExperienceSession,
    returnToTrail,
    getSettings: () => ({ ...state.settings }),
    getHintStatus: (challengeId) => ({
      revealed: state.learning.hintReveals[challengeId] || 0,
      maximum: Learning.MAX_HINTS,
      completed: state.completedChallenges[challengeId] === true
    }),
    useHint,
    announce: (text) => speakText(text),
    speak: (text) => speakText(text, true),
    stopSpeech,
    playSound,
  });
  window.ListenerSession = Object.freeze({
    get: () => state.session && {
      id: state.session.id,
      startedAt: state.session.startedAt,
      registered: state.session.registered,
      player: { ...state.session.player, access: { ...state.session.player.access } },
      profile: { ...state.session.profile, hints: { ...state.session.profile.hints }, readAloud: { ...state.session.profile.readAloud } },
    },
  });
  window.ListenerTrail = Object.freeze({
    getState: () => ({ ...state.completedChallenges }),
    completeChallenge,
    validatePlayer,
    getProfile,
  });

  document.querySelectorAll('[data-page-link]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (isTrackComplete() && button.dataset.pageLink !== 'game' && button.dataset.pageLink !== 'completion') return;
      if (state.session && button.dataset.pageLink === 'home') return;
      if (state.currentScreen === 'game' && button.dataset.pageLink !== 'game' &&
          window.ListenerGame?.getState().running) {
        showPage(button.dataset.pageLink);
        return;
      }
      showPage(button.dataset.pageLink);
    });
  });

  document.getElementById('navigationMenuToggle').addEventListener('click', () => setMenuOpen(true));
  document.getElementById('closeNavigationMenu').addEventListener('click', () => setMenuOpen(false));
  document.getElementById('navigationScrim').addEventListener('click', () => setMenuOpen(false));
  document.querySelectorAll('[data-menu-page]').forEach((button) => {
    button.addEventListener('click', () => navigateFromMenu(button.dataset.menuPage));
  });
  document.getElementById('resumeTrailChallenge').addEventListener('click', () => navigateFromMenu('game'));
  document.getElementById('resumePerformanceChallenge').addEventListener('click', () => navigateFromMenu('game'));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('navigationDrawer').hidden) setMenuOpen(false);
    else containMenuFocus(event);
  });
  document.getElementById('settingReadAloud').addEventListener('change', (event) => {
    state.settings.readAloud = event.target.checked;
    if (state.session) state.session.profile.readAloud.enabled = event.target.checked;
    saveSettings();
    if (!state.settings.readAloud) stopSpeech();
    else document.getElementById('speechStatus').textContent = 'Leitura automática dos feedbacks ativada.';
  });
  document.getElementById('settingSound').addEventListener('change', (event) => {
    state.settings.soundEffects = event.target.checked;
    saveSettings();
    if (state.settings.soundEffects && !playSound('confirm')) {
      document.getElementById('settingsStatus').textContent = 'Efeitos sonoros não disponíveis neste navegador.';
    }
  });
  document.getElementById('settingVolume').addEventListener('input', (event) => {
    state.settings.volume = Number(event.target.value);
    document.getElementById('volumeValue').textContent = `${state.settings.volume}%`;
    saveSettings();
  });
  document.getElementById('settingHighContrast').addEventListener('change', (event) => {
    state.settings.highContrast = event.target.checked;
    saveSettings();
  });
  document.getElementById('settingReducedMotion').addEventListener('change', (event) => {
    state.settings.reducedMotion = event.target.checked;
    saveSettings();
  });
  document.getElementById('speakChallenge').addEventListener('click', () => {
    const challenge = window.ListenerMissions.CHALLENGES[state.currentChallengeId];
    if (!challenge) {
      document.getElementById('speechStatus').textContent = 'Inicie um desafio para ouvir sua descrição.';
      return;
    }
    speakText(`${challenge.title}. ${challenge.description} Destino: ${challenge.destination.arrival}.`, true);
  });
  document.getElementById('stopSpeech').addEventListener('click', stopSpeech);

  document.getElementById('playButton').addEventListener('click', beginQuestionnaire);
  document.getElementById('splashSkip').addEventListener('click', finishSplash);
  applySettings();

  void flushPendingSubmissions();
  header.hidden = true;
  showPage('home');
  header.hidden = true;
  splashTimer = window.setTimeout(finishSplash, 620);
})();
