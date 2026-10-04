/**
 * Searching the Library: the sidebar search box and the command palette's
 * Notes section, both backed by Prax's note search.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LibrarySearch } from './LibrarySearch';
import { CommandPalette } from '@/components/common/CommandPalette';

const HIT = { space: 'linear-algebra', notebook: 'lectures', slug: 'eigenvalues', title: 'Eigenvalues',
  tags: [], snippet: 'An eigenvector keeps its direction…', updated_at: '' };

vi.mock('@/hooks/useApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useApi')>()),
  useLibrarySearch: (q: string) => ({
    isLoading: false, isError: false, data: q.trim().length >= 2 ? [HIT] : undefined,
  }),
  searchLibrary: vi.fn(async () => [HIT]),
  searchMessages: vi.fn(async () => ({ results: [], total: 0 })),
}));

vi.mock('@/stores', () => ({
  useUIStore: (sel: (s: object) => unknown) => sel({ darkMode: false, toggleDarkMode: () => {} }),
  useProjectStore: (sel: (s: object) => unknown) => sel({ channels: [], agents: [], currentProject: { id: 'p1' } }),
}));

describe('LibrarySearch', () => {
  it('shows matching notes and opens the one picked', () => {
    const onOpen = vi.fn();
    render(<LibrarySearch dark={false} onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'eigen' } });
    expect(screen.getByText('An eigenvector keeps its direction…')).toBeTruthy();
    fireEvent.click(screen.getByText('Eigenvalues'));
    expect(onOpen).toHaveBeenCalledWith('linear-algebra', 'lectures', 'eigenvalues');
  });

  it('waits for two characters', () => {
    render(<LibrarySearch dark={false} onOpen={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'e' } });
    expect(screen.queryByText('Eigenvalues')).toBeNull();
  });
});

describe('CommandPalette notes', () => {
  it('lists notes from the search and opens one', async () => {
    const onOpenNote = vi.fn();
    render(<CommandPalette onOpenNote={onOpenNote} />);
    act(() => { window.dispatchEvent(new Event('open-command-palette')); });
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'eigen' } });
    await waitFor(() => expect(screen.getByText('Notes')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByText('Eigenvalues'));
    expect(onOpenNote).toHaveBeenCalledWith('linear-algebra', 'lectures', 'eigenvalues');
  });
});
