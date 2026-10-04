import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

describe('MarkdownContent re-rendering', () => {
  it('keeps the same DOM when nothing changed', () => {
    // It used to hand react-markdown new component types on every render, so
    // any parent re-render rebuilt the DOM: a selection in progress was lost,
    // and so were the ranges that highlight commented passages.
    const { rerender } = render(<MarkdownContent content={'Hello **world**'} darkMode={false} />);
    const before = screen.getByText('world');
    rerender(<MarkdownContent content={'Hello **world**'} darkMode={false} />);
    expect(screen.getByText('world')).toBe(before);
    rerender(<MarkdownContent content={'Hello **there**'} darkMode={false} />);
    expect(screen.getByText('there')).toBeTruthy();
  });
});
