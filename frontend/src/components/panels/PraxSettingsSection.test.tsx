/**
 * The Prax settings section: Prax's list of changeable settings, as switches.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PraxSettingsSection } from './SettingsPanel';

const mutate = vi.fn();
const SETTINGS = [
  { key: 'DESKTOP_SCREENSHOTS_ENABLED', label: 'Prax can look at the desktop', help: 'Billed per look.',
    category: 'Desktop', value: true, source: 'env', env_value: true },
  { key: 'ARTIFACTS_ENABLED', label: 'Artifacts', help: 'Pages Prax keeps updating.',
    category: 'Features', value: true, source: 'teamwork', env_value: false },
];

vi.mock('@/hooks/useApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useApi')>()),
  useRuntimeSettings: () => ({ data: { settings: SETTINGS }, isError: false }),
  useSetRuntimeSetting: () => ({ mutate, isPending: false }),
}));

describe('PraxSettingsSection', () => {
  it('shows each setting as a switch, grouped by category', () => {
    render(<PraxSettingsSection darkMode={false} heading="" subtext="" />);
    expect(screen.getByText('Desktop')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Prax can look at the desktop' }).getAttribute('aria-checked')).toBe('true');
  });

  it('turns screenshots off', () => {
    render(<PraxSettingsSection darkMode={false} heading="" subtext="" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Prax can look at the desktop' }));
    expect(mutate).toHaveBeenCalledWith({ key: 'DESKTOP_SCREENSHOTS_ENABLED', value: false }, expect.anything());
  });

  it('offers a reset only for what was changed here', () => {
    render(<PraxSettingsSection darkMode={false} heading="" subtext="" />);
    const resets = screen.getAllByText('reset');
    expect(resets).toHaveLength(1);
    fireEvent.click(resets[0]);
    expect(mutate).toHaveBeenCalledWith({ key: 'ARTIFACTS_ENABLED', value: null }, expect.anything());
  });
});
