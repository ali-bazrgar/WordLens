/* WordLens FSRS-6 scheduler.
 * Reference formulas and default parameters: open-spaced-repetition/awesome-fsrs,
 * "The Algorithm — FSRS-6". No runtime dependency; works in browser and Node tests.
 */
(function (root) {
  'use strict';

  const VERSION = 6;
  const DEFAULT_PARAMETERS = Object.freeze([
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194,
    0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
    1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
  ]);
  const DAY_MS = 86400000;
  const DEFAULT_RETENTION = 0.9;
  const DEFAULT_MAX_INTERVAL = 36500;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const initialStability = grade => Math.max(DEFAULT_PARAMETERS[grade - 1], 0.1);
  const initialDifficulty = grade => clamp(
    DEFAULT_PARAMETERS[4] - Math.exp(DEFAULT_PARAMETERS[5] * (grade - 1)) + 1,
    1,
    10
  );

  function calculate(card, grade, now = new Date(), options = {}) {
    if (![1, 2, 3, 4].includes(grade)) {
      throw new RangeError('FSRS-6 grade must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy).');
    }
    const currentDate = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (Number.isNaN(currentDate.getTime())) throw new TypeError('FSRS-6 requires a valid review date.');

    const w = DEFAULT_PARAMETERS;
    const retention = clamp(Number(options.desiredRetention) || DEFAULT_RETENTION, 0.7, 0.99);
    const maxInterval = Math.max(1, Math.floor(Number(options.maximumInterval) || DEFAULT_MAX_INTERVAL));
    const factor = Math.pow(0.9, -1 / w[20]) - 1;
    const intervalModifier = (Math.pow(retention, -1 / w[20]) - 1) / factor;

    const storedStability = Number(card?.stability);
    const storedDifficulty = Number(card?.difficulty);
    const hasMemoryState =
      Number.isFinite(storedStability) && storedStability > 0 &&
      Number.isFinite(storedDifficulty) && storedDifficulty > 0;
    let stability;
    let difficulty;
    let elapsedDays = 0;
    let retrievability = 1;

    if (!hasMemoryState) {
      stability = initialStability(grade);
      difficulty = initialDifficulty(grade);
    } else {
      const previousStability = clamp(storedStability, 0.01, maxInterval);
      const previousDifficulty = clamp(storedDifficulty, 1, 10);
      const lastReviewed = card?.lastReviewed ? new Date(card.lastReviewed) : null;
      elapsedDays = lastReviewed && !Number.isNaN(lastReviewed.getTime())
        ? Math.max(0, (currentDate.getTime() - lastReviewed.getTime()) / DAY_MS)
        : 0;
      retrievability = Math.pow(
        1 + factor * elapsedDays / previousStability,
        -w[20]
      );
      retrievability = clamp(retrievability, 0, 1);

      // FSRS difficulty update with linear damping and mean reversion to D0(Easy).
      const deltaDifficulty = -w[6] * (grade - 3);
      const dampedDifficulty = previousDifficulty + deltaDifficulty * (10 - previousDifficulty) / 9;
      const easyInitialDifficulty = initialDifficulty(4);
      difficulty = clamp(w[7] * easyInitialDifficulty + (1 - w[7]) * dampedDifficulty, 1, 10);

      if (elapsedDays < 1) {
        // FSRS-6 short-term stability update (includes the w19 saturation term).
        let multiplier = Math.exp(w[17] * (grade - 3 + w[18])) *
          Math.pow(previousStability, -w[19]);
        if (grade >= 2) multiplier = Math.max(1, multiplier);
        stability = previousStability * multiplier;
      } else if (grade === 1) {
        // Stability after forgetting/lapse.
        const candidate = w[11] * Math.pow(previousDifficulty, -w[12]) *
          (Math.pow(previousStability + 1, w[13]) - 1) *
          Math.exp(w[14] * (1 - retrievability));
        const shortTermCap = previousStability / Math.exp(w[17] * w[18]);
        stability = clamp(candidate, 0.01, Math.max(0.01, Math.min(previousStability, shortTermCap)));
      } else {
        // Stability after successful recall. w15 penalizes Hard; w16 rewards Easy.
        let multiplier = Math.exp(w[8]) * (11 - previousDifficulty) *
          Math.pow(previousStability, -w[9]) *
          (Math.exp(w[10] * (1 - retrievability)) - 1);
        if (grade === 2) multiplier *= w[15];
        if (grade === 4) multiplier *= w[16];
        stability = previousStability * (multiplier + 1);
      }
    }

    stability = clamp(Number.isFinite(stability) ? stability : 0.1, 0.01, maxInterval);
    difficulty = clamp(Number.isFinite(difficulty) ? difficulty : 5, 1, 10);
    const intervalDays = grade === 1
      ? 0
      : clamp(Math.round(stability * intervalModifier), 1, maxInterval);

    return {
      version: VERSION,
      grade,
      stability,
      difficulty,
      elapsedDays,
      retrievability,
      intervalDays,
      desiredRetention: retention
    };
  }

  const api = Object.freeze({
    version: VERSION,
    defaultParameters: DEFAULT_PARAMETERS,
    calculate,
    initialStability,
    initialDifficulty
  });

  root.WordLensFSRS6 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
