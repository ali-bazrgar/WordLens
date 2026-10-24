const test = require('node:test');
const assert = require('node:assert/strict');
const fsrs = require('../fsrs6.js');

test('FSRS-6 initial states use the published default stability values', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  assert.equal(fsrs.calculate({}, 1, now).stability, 0.212);
  assert.equal(fsrs.calculate({}, 2, now).stability, 1.2931);
  assert.equal(fsrs.calculate({}, 3, now).stability, 2.3065);
  assert.equal(fsrs.calculate({}, 4, now).stability, 8.2956);
});

test('Again is due in the current session; successful first reviews get at least one day', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  assert.equal(fsrs.calculate({}, 1, now).intervalDays, 0);
  for (const grade of [2, 3, 4]) {
    assert.ok(fsrs.calculate({}, grade, now).intervalDays >= 1);
  }
});

test('difficulty remains within FSRS bounds and values stay finite after reviews', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  let card = { stability: 2.3065, difficulty: 4, lastReviewed: '2026-10-20T12:00:00.000Z' };
  for (const grade of [1, 2, 3, 4, 3, 2, 1]) {
    const next = fsrs.calculate(card, grade, now);
    assert.ok(Number.isFinite(next.stability) && next.stability >= 0.01);
    assert.ok(Number.isFinite(next.difficulty) && next.difficulty >= 1 && next.difficulty <= 10);
    assert.ok(Number.isInteger(next.intervalDays) && next.intervalDays >= 0);
    card = { ...card, stability: next.stability, difficulty: next.difficulty, lastReviewed: now.toISOString() };
  }
});

test('same-day Hard and Good do not reduce stability; Again can reduce it', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  const card = { stability: 2.3065, difficulty: 5, lastReviewed: now.toISOString() };
  assert.ok(fsrs.calculate(card, 2, now).stability >= card.stability);
  assert.ok(fsrs.calculate(card, 3, now).stability >= card.stability);
  assert.ok(fsrs.calculate(card, 1, now).stability > 0);
});

test('invalid grade fails explicitly', () => {
  assert.throws(() => fsrs.calculate({}, 5), RangeError);
});
