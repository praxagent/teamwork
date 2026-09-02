/**
 * describeCron rendered "Daily at NaN:00 PM" for `0 9-20 * * *` — an hour
 * RANGE, which is exactly what "hourly from 9am to 9pm" compiles to, fed
 * through Number('9-20'). A schedule the agent had just created for a real
 * user was displayed as garbage. Rule pinned here: render what is known,
 * fall back to the raw cron, NEVER print NaN.
 */
import { describe, expect, it } from 'vitest';

// The function is module-private; import the module and reach it via a
// re-export shim would be heavier than testing through the panel. Re-declare
// the contract instead by importing the panel file's export if present.
import * as Panel from './SchedulerPanel';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const describeCron: (c: string) => string = (Panel as any).describeCron;

describe('describeCron', () => {
  it('is exported for testing', () => {
    expect(typeof describeCron).toBe('function');
  });
  it('renders an hour range as a range, not NaN (the shipped bug)', () => {
    const out = describeCron('0 9-20 * * *');
    expect(out).not.toContain('NaN');
    expect(out).toMatch(/9:00 AM/);
    expect(out).toMatch(/8:00 PM/);
    expect(out).toMatch(/hourly/i);
  });
  it('renders an hour list', () => {
    const out = describeCron('30 9,12,15 * * *');
    expect(out).not.toContain('NaN');
    expect(out).toContain('9:30 AM');
    expect(out).toContain('3:30 PM');
  });
  it('keeps the simple cases', () => {
    expect(describeCron('0 9 * * *')).toBe('Daily at 9:00 AM');
    expect(describeCron('0 13 * * 1-5')).toBe('Weekdays at 1:00 PM');
    expect(describeCron('0 * * * *')).toBe('Hourly at :00');
    expect(describeCron('15 */2 * * *')).toBe('Every 2h at :15');
  });
  it('falls back to the raw cron for anything it cannot parse — never NaN', () => {
    for (const weird of ['0 9-20/2 * * *', '0 25 * * *', '0 a * * *']) {
      expect(describeCron(weird)).not.toContain('NaN');
    }
  });
});
