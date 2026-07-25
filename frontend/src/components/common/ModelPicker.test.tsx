/**
 * What the picker is allowed to claim.
 *
 * The interesting cases are not "does it list models" but the honesty ones: a
 * provider whose credential lives in the secrets-proxy must not be shown as
 * confirmed, and an unconfigured provider must say WHY rather than vanishing.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModelPicker } from './ModelPicker';
import type { ModelInfo } from '@/hooks/useApi';

const base: ModelInfo = {
  current_model: 'gpt-5.4-mini',
  current_tier: 'medium',
  override: null,
  available: [],
  mode: 'auto',
  egress_proxied: false,
  tiers: {
    low: { model: 'gpt-5.4-nano', enabled: true, provider: 'openai' },
    medium: { model: 'gpt-5.4-mini', enabled: true, provider: 'openai' },
    high: { model: 'gpt-5.5', enabled: true, provider: 'openai' },
    pro: { model: 'gpt-5.5-pro', enabled: false, provider: 'openai' },
  },
  providers: [
    { id: 'openai', label: 'OpenAI', configured: true, verified: true, reason: null,
      models: ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.5'] },
    { id: 'anthropic', label: 'Anthropic', configured: false, verified: false,
      reason: 'no ANTHROPIC_KEY configured', models: [] },
  ],
};

const info = (over: Partial<ModelInfo> = {}): ModelInfo => ({ ...base, ...over });

describe('ModelPicker', () => {
  it('offers Auto as a first-class choice, not just an empty selection', () => {
    render(<ModelPicker info={info()} onSelect={vi.fn()} />);
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText(/agent picks per task/)).toBeInTheDocument();
  });

  it('selecting Auto clears the override rather than sending a model name', () => {
    const onSelect = vi.fn();
    render(<ModelPicker info={info({ mode: 'model', override: 'gpt-5.5' })} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Auto'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('pins a LEVEL distinctly from pinning a model', () => {
    const onSelect = vi.fn();
    render(<ModelPicker info={info()} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('High'));
    expect(onSelect).toHaveBeenCalledWith('high');   // the tier, not gpt-5.5
  });

  it('shows which model currently sits behind a level', () => {
    // "High" alone is a mystery; naming the model makes the choice informed.
    render(<ModelPicker info={info()} onSelect={vi.fn()} />);
    expect(screen.getByTitle('Currently gpt-5.5')).toBeInTheDocument();
  });

  it('disables a tier that is switched off', () => {
    render(<ModelPicker info={info()} onSelect={vi.fn()} />);
    expect(screen.getByText('Pro').closest('button')).toBeDisabled();
  });

  it('pins an exact model when one is chosen', () => {
    const onSelect = vi.fn();
    render(<ModelPicker info={info()} onSelect={onSelect} />);
    // The name appears twice by design — once as "what Low currently is", once
    // as a pinnable model. Target the provider-list entry by exact accessible name.
    fireEvent.click(screen.getByRole('button', { name: 'gpt-5.4-nano' }));
    expect(onSelect).toHaveBeenCalledWith('gpt-5.4-nano');
  });

  it('shows an unconfigured provider WITH the reason instead of hiding it', () => {
    // A provider that silently vanishes is a support ticket.
    render(<ModelPicker info={info()} onSelect={vi.fn()} />);
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('no ANTHROPIC_KEY configured')).toBeInTheDocument();
  });

  it('does not claim a proxied credential is confirmed', () => {
    // configured=true / verified=false is the honest keyless answer.
    render(
      <ModelPicker
        info={info({
          egress_proxied: true,
          providers: [{ id: 'openai', label: 'OpenAI', configured: true, verified: false,
                        reason: 'egress is proxied — the secrets-proxy holds the real credential',
                        models: ['gpt-5.5'] }],
        })}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/secrets-proxy holds the real credential/)).toBeInTheDocument();
    expect(screen.getByText(/availability here is/)).toBeInTheDocument();
  });

  it('marks the active selection', () => {
    const { container } = render(
      <ModelPicker info={info({ mode: 'tier', override: 'high' })} onSelect={vi.fn()} />);
    expect(container.querySelectorAll('.text-green-500').length).toBeGreaterThan(0);
  });

  it('survives an older agent that sends none of the catalog fields', () => {
    // The fields are optional on purpose — an older Prax must not blank the UI.
    render(
      <ModelPicker
        info={{ current_model: 'gpt-4o', current_tier: 'medium', override: null, available: [] }}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('handles a provider that is configured but has no models assigned', () => {
    render(
      <ModelPicker
        info={info({ providers: [{ id: 'openrouter', label: 'OpenRouter', configured: true,
                                   verified: true, reason: null, models: [] }] })}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/No models assigned/)).toBeInTheDocument();
  });
});
