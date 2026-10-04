/**
 * Safe note editing in TeamWork: a stale save becomes a choice, not a silent
 * overwrite; a note's versions can be seen and restored; deleted items can be
 * brought back from the trash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteConflictBanner, NoteHistoryPanel } from './NoteSafety';
import { LibraryTrash } from '@/components/panels/LibraryTrash';
import { NoteConflictError } from '@/hooks/useApi';

const restoreVersion = vi.fn();
const restoreTrash = vi.fn();
const purgeTrash = vi.fn();

vi.mock('@/hooks/useApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useApi')>()),
  useNoteHistory: () => ({
    isLoading: false,
    data: { versions: [
      { commit: 'bbb2222', date: '2026-10-04T12:05:00Z', author: 'Prax', message: 'library: prax edited' },
      { commit: 'aaa1111', date: '2026-10-04T12:00:00Z', author: 'You (TeamWork)', message: 'library: human created note' },
    ] },
  }),
  useNoteVersion: (_p: string, _n: string, _s: string, commit: string | null) => ({
    isLoading: false,
    data: commit ? { commit, content: 'old', diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old line\n+new line\n' } : undefined,
  }),
  useRestoreNoteVersion: () => ({ mutate: restoreVersion, isPending: false }),
  useLibraryTrash: () => ({
    isLoading: false,
    data: { items: [{ id: '20261004T120000-a1b2c3', kind: 'note', label: 'Eigenvalues',
      original: 'spaces/la/lectures/eigenvalues.md', deleted_at: '2026-10-04T12:00:00+00:00', deleted_by: 'human' }] },
  }),
  useRestoreTrashItem: () => ({ mutate: restoreTrash, isPending: false, isError: false }),
  usePurgeTrashItem: () => ({ mutate: purgeTrash, isPending: false }),
}));

beforeEach(() => { restoreVersion.mockReset(); restoreTrash.mockReset(); purgeTrash.mockReset(); });

describe('NoteConflictBanner', () => {
  const conflict = new NoteConflictError('changed', {
    meta: { last_edited_by: 'prax', updated_at: '2026-10-04T12:05:00Z' }, content: "Prax's",
  });

  it('says who changed it and offers both choices', () => {
    const keep = vi.fn();
    const take = vi.fn();
    render(<NoteConflictBanner conflict={conflict} dark={false} onKeepMine={keep} onTakeTheirs={take} />);
    expect(screen.getByText(/Prax saved a newer version/)).toBeTruthy();
    fireEvent.click(screen.getByText('Keep my version'));
    fireEvent.click(screen.getByText(/Take theirs/));
    expect(keep).toHaveBeenCalledOnce();
    expect(take).toHaveBeenCalledOnce();
  });
});

describe('NoteHistoryPanel', () => {
  it('lists versions, shows a diff, and restores an older one', () => {
    render(<NoteHistoryPanel project="la" notebook="lectures" slug="eigenvalues" dark={false} onClose={() => {}} />);
    expect(screen.getByText(/Prax · current/)).toBeTruthy();
    fireEvent.click(screen.getByText(/· You$/));
    expect(screen.getByText('-old line')).toBeTruthy();
    expect(screen.getByText('+new line')).toBeTruthy();
    fireEvent.click(screen.getByText('Restore this version'));
    expect(restoreVersion).toHaveBeenCalledWith(
      { project: 'la', notebook: 'lectures', slug: 'eigenvalues', commit: 'aaa1111' }, expect.anything());
  });

  it('does not offer to restore the current version', () => {
    render(<NoteHistoryPanel project="la" notebook="lectures" slug="eigenvalues" dark={false} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Prax · current/));
    expect(screen.queryByText('Restore this version')).toBeNull();
  });
});

describe('LibraryTrash', () => {
  it('restores, and deletes for good only after confirming', () => {
    render(<LibraryTrash dark={false} />);
    expect(screen.getByText('Eigenvalues')).toBeTruthy();
    fireEvent.click(screen.getByText('Restore'));
    expect(restoreTrash).toHaveBeenCalledWith('20261004T120000-a1b2c3');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByLabelText('Delete Eigenvalues for good'));
    expect(purgeTrash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Delete Eigenvalues for good'));
    expect(purgeTrash).toHaveBeenCalledWith('20261004T120000-a1b2c3');
    confirm.mockRestore();
  });
});
