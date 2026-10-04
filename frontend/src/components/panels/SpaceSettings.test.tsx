/**
 * Space settings: the description (the line under a space's name on the
 * Spaces page) can be edited, saved and cleared, like the name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceSettings } from './SpacePage';
import type { LibrarySpace } from '@/hooks/useApi';

vi.mock('@/hooks/useApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useApi')>()),
  useCurrentModel: () => ({ data: undefined }),
  useSpaceModel: () => ({ data: undefined }),
  useSetSpaceModel: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/common/ModelSection', () => ({ ModelSection: () => null }));
vi.mock('@/components/common/McpSection', () => ({ McpSection: () => null }));

const SPACE: LibrarySpace = {
  slug: 'linear-algebra',
  name: 'Linear Algebra',
  description: 'Matrices and vector spaces',
  notebook_count: 0,
  notebooks: [],
};

function renderSettings(space: LibrarySpace = SPACE) {
  const onUpdateDescription = vi.fn();
  const onUpdateName = vi.fn();
  render(
    <SpaceSettings
      space={space}
      dark={false}
      spaceSlug={space.slug}
      onDelete={vi.fn()}
      onUpdateTheme={vi.fn()}
      onUpdateName={onUpdateName}
      onUpdateDescription={onUpdateDescription}
      uploadCover={{ mutate: vi.fn(), isPending: false }}
      generateCover={{ mutate: vi.fn(), isPending: false }}
      deleteCover={{ mutate: vi.fn() }}
      coverSrc={null}
      onUploadClick={vi.fn()}
    />,
  );
  const field = screen.getByLabelText('DESCRIPTION') as HTMLTextAreaElement;
  // The description's Save button is the one next to its field.
  const save = field.parentElement!.querySelector('button') as HTMLButtonElement;
  return { field, save, onUpdateDescription, onUpdateName };
}

describe('SpaceSettings — description', () => {
  it('shows the current description, with Save off until it changes', () => {
    const { field, save } = renderSettings();
    expect(field.value).toBe('Matrices and vector spaces');
    expect(save.disabled).toBe(true);
  });

  it('saves an edited description, trimmed', () => {
    const { field, save, onUpdateDescription, onUpdateName } = renderSettings();
    fireEvent.change(field, { target: { value: '  Matrices, vector spaces and eigenvalues  ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onUpdateDescription).toHaveBeenCalledWith('Matrices, vector spaces and eigenvalues');
    expect(onUpdateName).not.toHaveBeenCalled();
  });

  it('can clear it', () => {
    const { field, save, onUpdateDescription } = renderSettings();
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(save);
    expect(onUpdateDescription).toHaveBeenCalledWith('');
  });

  it('can add one to a space that has none', () => {
    const { field, save, onUpdateDescription } = renderSettings({ ...SPACE, description: undefined });
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: 'Notes from the course' } });
    fireEvent.click(save);
    expect(onUpdateDescription).toHaveBeenCalledWith('Notes from the course');
  });

  it('treats whitespace-only edits as unchanged', () => {
    const { field, save } = renderSettings();
    fireEvent.change(field, { target: { value: 'Matrices and vector spaces   ' } });
    expect(save.disabled).toBe(true);
  });
});
