(function (global) {
  'use strict';

  const VERSION = 1;
  const MAX_SCORE = 100;
  const HINT_PENALTY = 10;
  const MAX_HINT_PENALTY = 30;
  const MAX_HINTS = 3;
  const HISTORY_LIMIT = 100;

  function createState(challengeIds, stored = {}) {
    const completedChallenges = {};
    const pointsByChallenge = {};
    const hintReveals = {};

    challengeIds.forEach((id) => {
      completedChallenges[id] = stored.completedChallenges?.[id] === true;
      const points = Number(stored.pointsByChallenge?.[id]);
      if (completedChallenges[id] && Number.isFinite(points) && points >= 0 && points <= MAX_SCORE) {
        pointsByChallenge[id] = Math.floor(points);
      }
      const reveals = Number(stored.hintReveals?.[id]);
      hintReveals[id] = Number.isInteger(reveals) ? Math.max(0, Math.min(MAX_HINTS, reveals)) : 0;
    });

    return {
      version: VERSION,
      completedChallenges,
      pointsByChallenge,
      hintReveals,
      history: Array.isArray(stored.history)
        ? stored.history.filter((entry) => entry && typeof entry.type === 'string' && typeof entry.at === 'string').slice(-HISTORY_LIMIT)
        : [],
      achievements: Array.isArray(stored.achievements)
        ? [...new Set(stored.achievements.filter((id) => typeof id === 'string'))]
        : []
    };
  }

  function scoreTotal(state) {
    return Object.values(state.pointsByChallenge).reduce((sum, points) => sum + points, 0);
  }

  function useHint(state, challengeId, age) {
    if (!Object.prototype.hasOwnProperty.call(state.hintReveals, challengeId)) {
      return { accepted: false, reason: 'O desafio não está no catálogo.' };
    }
    if (state.completedChallenges[challengeId]) {
      return { accepted: false, reason: 'Este desafio já foi concluído.' };
    }
    const current = state.hintReveals[challengeId];
    if (current >= MAX_HINTS) return { accepted: false, reason: 'Todas as dicas deste desafio já foram usadas.' };

    const reveal = current + 1;
    state.hintReveals[challengeId] = reveal;
    return {
      accepted: true,
      reveal,
      penalty: age >= 12 ? Math.min(reveal, MAX_HINT_PENALTY / HINT_PENALTY) * HINT_PENALTY : 0
    };
  }

  function awardCompletion(state, challenge, result, pedagogy, age, foundations = []) {
    if (!challenge || !result || result.valid !== true || result.result !== 'complete' ||
        result.reached !== true || pedagogy?.valid !== true ||
        !result.state?.robot ||
        result.state.robot.x !== challenge.destination.position.x ||
        result.state.robot.y !== challenge.destination.position.y) {
      return { accepted: false, reason: 'A missão precisa ser concluída e validada no destino exato.' };
    }
    if (!Object.prototype.hasOwnProperty.call(state.completedChallenges, challenge.id)) {
      return { accepted: false, reason: 'O desafio não está no catálogo.' };
    }
    if (state.completedChallenges[challenge.id]) {
      return { accepted: false, alreadyCompleted: true, points: state.pointsByChallenge[challenge.id] || 0 };
    }

    const previousAchievements = new Set(progress(state, foundations).achievements.map((achievement) => achievement.id));
    const hints = state.hintReveals[challenge.id] || 0;
    const penalty = age >= 12 ? Math.min(hints * HINT_PENALTY, MAX_HINT_PENALTY) : 0;
    const points = Math.max(0, MAX_SCORE - penalty);
    state.completedChallenges[challenge.id] = true;
    state.pointsByChallenge[challenge.id] = points;
    state.history.push({ type: 'challenge-completed', challengeId: challenge.id, points, at: new Date().toISOString() });
    progress(state, foundations).achievements.forEach((achievement) => {
      if (previousAchievements.has(achievement.id) || state.achievements.includes(achievement.id)) return;
      state.achievements.push(achievement.id);
      state.history.push({
        type: 'achievement-unlocked',
        achievementId: achievement.id,
        title: achievement.title,
        at: new Date().toISOString()
      });
    });
    state.history = state.history.slice(-HISTORY_LIMIT);
    return { accepted: true, points, penalty, hints };
  }

  function progress(state, foundations) {
    const challenges = foundations.flatMap((foundation) => foundation.challengeIds);
    const completed = challenges.filter((id) => state.completedChallenges[id]).length;
    const current = foundations.find((foundation) =>
      foundation.challengeIds.some((id) => !state.completedChallenges[id]));
    const achievements = [];
    if (completed >= 1) achievements.push({ id: 'first-challenge', title: 'Primeiro desafio', achieved: true });
    foundations.forEach((foundation) => {
      const achieved = foundation.challengeIds.every((id) => state.completedChallenges[id]);
      if (achieved) achievements.push({
        id: `foundation-${foundation.key}`,
        title: `Fundamento concluído: ${foundation.label}`,
        achieved: true
      });
    });
    if (completed === challenges.length) achievements.push({ id: 'full-track', title: 'Trilha concluída', achieved: true });
    return {
      score: scoreTotal(state),
      completed,
      total: challenges.length,
      currentFoundation: current?.label || null,
      completedFoundations: foundations.filter((foundation) =>
        foundation.challengeIds.every((id) => state.completedChallenges[id])).length,
      achievements
    };
  }

  function toStorage(state) {
    return {
      version: VERSION,
      completedChallenges: { ...state.completedChallenges },
      pointsByChallenge: { ...state.pointsByChallenge },
      hintReveals: { ...state.hintReveals },
      history: state.history.slice(-HISTORY_LIMIT),
      achievements: [...state.achievements]
    };
  }

  const api = Object.freeze({
    VERSION,
    MAX_SCORE,
    HINT_PENALTY,
    MAX_HINT_PENALTY,
    MAX_HINTS,
    createState,
    scoreTotal,
    useHint,
    awardCompletion,
    progress,
    toStorage
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ListenerLearning = api;
})(typeof window !== 'undefined' ? window : globalThis);
