import { describe, expect, it } from 'vitest';
import { setTaskChecked, taskOrdinalAtLine } from './taskList';

const doc = [
  'Problems:',          // 1
  '',                   // 2
  '- [ ] Two Sum',      // 3
  '- [x] Group Anagrams', // 4
  '```',                // 5
  '- [ ] not a task, inside a fence', // 6
  '```',                // 7
  '1. [ ] numbered',    // 8
  '  * [X] nested',     // 9
].join('\n');

describe('taskOrdinalAtLine', () => {
  it('numbers tasks in order, skipping fenced code', () => {
    expect([3, 4, 8, 9].map((l) => taskOrdinalAtLine(doc, l))).toEqual([0, 1, 2, 3]);
  });
  it('is -1 off a task line', () => {
    expect(taskOrdinalAtLine(doc, 1)).toBe(-1);
    expect(taskOrdinalAtLine(doc, 6)).toBe(-1);
  });
});

describe('setTaskChecked', () => {
  it('ticks and unticks exactly one task', () => {
    const ticked = setTaskChecked(doc, 0, true);
    expect(ticked.split('\n')[2]).toBe('- [x] Two Sum');
    expect(ticked.split('\n').filter((l, i) => i !== 2)).toEqual(doc.split('\n').filter((l, i) => i !== 2));
    expect(setTaskChecked(doc, 3, false).split('\n')[8]).toBe('  * [ ] nested');
  });
  it('leaves a fenced look-alike alone', () => {
    const out = setTaskChecked(doc, 2, true);
    expect(out.split('\n')[5]).toBe('- [ ] not a task, inside a fence');
    expect(out.split('\n')[7]).toBe('1. [x] numbered');
  });
  it('maps rendered order back to the source when bullets were rewritten', () => {
    // MarkdownContent renders "• [ ] a" as "- [ ] a"; the Nth box is still the Nth task.
    const source = '• [ ] a\n\n\n• [ ] b';
    expect(setTaskChecked(source, 1, true)).toBe('• [ ] a\n\n\n• [x] b');
  });
  it('returns the source unchanged for a task that is not there', () => {
    expect(setTaskChecked(doc, 9, true)).toBe(doc);
  });
});
