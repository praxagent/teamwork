import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { ArtifactFrame } from './ArtifactCard';

describe('ArtifactFrame', () => {
  it('runs the page sandboxed: scripts yes, TeamWork\'s origin no', () => {
    const { container } = render(<ArtifactFrame html="<h1>Plan</h1>" title="Plan" />);
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Plan</h1>');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('ignores size messages from any window but its own', () => {
    const { container } = render(<ArtifactFrame html="<p>x</p>" title="x" />);
    const frame = container.querySelector('iframe')!;
    const before = frame.style.height;
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { tvArtifactHeight: 9999 }, source: window }));
    });
    expect(frame.style.height).toBe(before);
  });
});
