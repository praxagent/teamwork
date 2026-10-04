/**
 * A save that meets a newer version rejects with NoteConflictError carrying
 * the current note — not a generic failure, and never a silent overwrite.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateLibraryNote, NoteConflictError } from './useApi';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => vi.restoreAllMocks());

describe('useUpdateLibraryNote', () => {
  it('turns a 409 into a NoteConflictError with the current note', async () => {
    const current = { meta: { updated_at: 'new', last_edited_by: 'prax' }, content: "Prax's" };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'changed', conflict: true, current }), { status: 409 }));
    const { result } = renderHook(() => useUpdateLibraryNote(), { wrapper });
    result.current.mutate({ project: 'la', notebook: 'lectures', slug: 'x', content: 'mine', expected_updated_at: 'old' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(NoteConflictError);
    expect((result.current.error as NoteConflictError).current).toEqual(current);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).expected_updated_at).toBe('old');
  });

  it('passes an ordinary failure through with its message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'is human-authored and prax_may_edit is false' }), { status: 400 }));
    const { result } = renderHook(() => useUpdateLibraryNote(), { wrapper });
    result.current.mutate({ project: 'la', notebook: 'lectures', slug: 'x', content: 'mine' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).not.toBeInstanceOf(NoteConflictError);
    expect((result.current.error as Error).message).toContain('prax_may_edit');
  });
});
