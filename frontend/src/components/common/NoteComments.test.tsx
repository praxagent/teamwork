/**
 * Comments on a passage of a Library note: the passage is found again in the
 * rendered note, threads show with their replies, and @prax shows Prax at
 * work until his reply lands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentableNote, locatePassage } from './NoteComments';
import type { NoteComment } from '@/hooks/useApi';

const addComment = vi.fn();
const replyComment = vi.fn();
const resolveComment = vi.fn();
let comments: NoteComment[] = [];

const mutation = (fn: ReturnType<typeof vi.fn>) => ({ mutate: fn, isPending: false, isError: false, error: null });

vi.mock('@/hooks/useApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useApi')>()),
  useNoteComments: () => ({ isLoading: false, data: { comments } }),
  useAddNoteComment: () => mutation(addComment),
  useReplyNoteComment: () => mutation(replyComment),
  useResolveNoteComment: () => mutation(resolveComment),
  useDeleteNoteComment: () => mutation(vi.fn()),
}));

const comment = (over: Partial<NoteComment> = {}): NoteComment => ({
  id: 'c-1a2b3c4d', author: 'human', text: 'Is this always true?', created_at: '2026-10-04T12:00:00+00:00',
  quote: 'keeps its direction', prefix: 'An eigenvector ', suffix: '.', resolved: false, replies: [], ...over,
});

beforeEach(() => { addComment.mockReset(); replyComment.mockReset(); resolveComment.mockReset(); comments = []; });

describe('locatePassage', () => {
  const root = () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>The <b>same</b> words.</p><p>Then the same words again.</p>';
    return div;
  };

  it('finds a passage that spans elements and paragraphs', () => {
    const r = locatePassage(root(), 'words.\n\nThen the');
    expect(r?.toString()).toBe('words.Then the');
  });

  it('picks the occurrence after the prefix', () => {
    const r = locatePassage(root(), 'same words', 'Then the ');
    expect(r?.startContainer.textContent).toBe('Then the same words again.');
  });

  it('returns null when the passage is gone', () => {
    expect(locatePassage(root(), 'not here')).toBeNull();
  });
});

describe('CommentableNote', () => {
  const note = (
    <CommentableNote project="la" notebook="lectures" slug="eigenvalues" dark={false} content="x">
      <p>An eigenvector keeps its direction.</p>
    </CommentableNote>
  );

  it('shows a thread with its passage and replies', () => {
    comments = [comment({ replies: [{ id: 'r-1', author: 'prax', text: 'For that matrix, yes.', created_at: '' }] })];
    render(note);
    expect(screen.getByText('Comments (1)')).toBeTruthy();
    expect(screen.getByText('keeps its direction')).toBeTruthy();
    expect(screen.getByText('For that matrix, yes.')).toBeTruthy();
    expect(screen.getByText('Prax')).toBeTruthy();
  });

  it('shows Prax at work after @prax', () => {
    comments = [comment({ text: '@prax is this always true?', prax_replying: true })];
    render(note);
    expect(screen.getByText(/Prax is replying/)).toBeTruthy();
  });

  it('says when the passage was edited away', () => {
    comments = [comment({ quote: 'a sentence that was deleted' })];
    render(note);
    expect(screen.getByText(/no longer in the note/)).toBeTruthy();
  });

  it('replies and resolves', () => {
    comments = [comment()];
    render(note);
    fireEvent.click(screen.getByText('Reply'));
    fireEvent.change(screen.getByPlaceholderText(/Reply/), { target: { value: '@prax find a source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(replyComment.mock.calls[0][0]).toMatchObject({ commentId: 'c-1a2b3c4d', text: '@prax find a source' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByText('Resolve'));
    expect(resolveComment.mock.calls[0][0]).toMatchObject({ commentId: 'c-1a2b3c4d', resolved: true });
  });

  it('hides resolved threads until asked', () => {
    comments = [comment({ resolved: true, text: 'Done with this one' })];
    render(note);
    expect(screen.queryByText('Done with this one')).toBeNull();
    fireEvent.click(screen.getByText('Show resolved (1)'));
    expect(screen.getByText('Done with this one')).toBeTruthy();
  });

  it('comments on the whole note', () => {
    render(note);
    fireEvent.click(screen.getByText('Comment on the note'));
    fireEvent.change(screen.getByPlaceholderText(/whole note/), { target: { value: 'Needs an example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(addComment.mock.calls[0][0]).toMatchObject({ project: 'la', slug: 'eigenvalues', text: 'Needs an example' });
  });
});
