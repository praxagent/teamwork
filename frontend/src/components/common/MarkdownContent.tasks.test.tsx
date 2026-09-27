import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

const md = 'Problems:\n\n- [ ] Two Sum\n- [x] Group Anagrams\n- [ ] Top K';

describe('MarkdownContent task lists', () => {
  it('are read-only without a handler (chat messages)', () => {
    render(<MarkdownContent content={md} darkMode={false} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    boxes.forEach((b) => expect(b).toBeDisabled());
  });

  it('report which task was ticked, and to what', () => {
    const onToggleTask = vi.fn();
    render(<MarkdownContent content={md} darkMode={false} onToggleTask={onToggleTask} />);
    const boxes = screen.getAllByRole('checkbox');
    boxes.forEach((b) => expect(b).toBeEnabled());
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true, false]);
    fireEvent.click(boxes[2]);
    expect(onToggleTask).toHaveBeenLastCalledWith(2, true);
    fireEvent.click(boxes[1]);
    expect(onToggleTask).toHaveBeenLastCalledWith(1, false);
  });
});
