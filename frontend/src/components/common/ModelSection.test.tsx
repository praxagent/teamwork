/**
 * The settings-page model control.
 *
 * The behaviour worth protecting is the difference between "inherit" and "pin
 * the model that is currently the default". They look identical the moment you
 * choose them and diverge forever after, so the UI has to keep them distinct.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ModelSection } from './ModelSection';
import type { ModelInfo } from '@/hooks/useApi';

const info = {
  current_model: 'gpt-5.4',
  override: null,
  mode: 'auto',
  providers: [{ id: 'openai', label: 'OpenAI', configured: true, verified: true, models: ['gpt-5.4', 'gpt-5.4-mini'] }],
  tiers: { medium: { model: 'gpt-5.4', enabled: true } },
} as unknown as ModelInfo;

const base = {
  title: 'Model',
  description: 'which model',
  info,
  onSelect: vi.fn(),
};

describe('ModelSection', () => {
  it('shows what an inherited choice currently resolves to', () => {
    // "inherited" alone tells you nothing about what you will actually get.
    render(<ModelSection {...base} value={null} inheritsTo="gpt-5.4" />);
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('inherited')).toBeInTheDocument();
  });

  it('does not call a pinned choice inherited', () => {
    render(<ModelSection {...base} value="claude-x" inheritsTo="gpt-5.4" />);
    expect(screen.getByText('claude-x')).toBeInTheDocument();
    expect(screen.queryByText('inherited')).not.toBeInTheDocument();
  });

  it('offers inheriting as its own choice, not just an absent pin', () => {
    const onSelect = vi.fn();
    render(
      <ModelSection {...base} onSelect={onSelect} value="claude-x"
        inheritsTo="gpt-5.4" inheritLabel="Follow the global model" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /claude-x/ }));
    fireEvent.click(screen.getByRole('button', { name: /Follow the global model/ }));
    // null, not the current default — clearing must keep following the default
    // as it changes, rather than freezing on today's value.
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('omits the inherit row where there is nothing to inherit from', () => {
    // The global setting has no parent, so offering "inherit" would be a lie.
    render(<ModelSection {...base} value="claude-x" />);
    fireEvent.click(screen.getByRole('button', { name: /claude-x/ }));
    expect(screen.queryByText(/Follow the global/)).not.toBeInTheDocument();
  });

  it('is inert until the model data arrives', () => {
    // Opening a picker with no catalogue shows an empty menu, which reads as
    // "there are no models" rather than "not loaded yet".
    render(<ModelSection {...base} info={undefined} value={null} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
