/**
 * The unlock screen. It must be invisible on a deployment with no key, and on
 * one with a key it must take the key, report a rejection, and go away on
 * success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { InternalKeyGate } from './InternalKeyGate';
import { useInternalKeyStore } from '@/hooks/useInternalKey';

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useInternalKeyStore.setState({ locked: false, error: null, submitting: false });
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('InternalKeyGate', () => {
  it('renders nothing while the app is not locked', () => {
    const { container } = render(<InternalKeyGate />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appears when locked, rejects a bad key, and closes on a good one', async () => {
    useInternalKeyStore.getState().lock();
    render(<InternalKeyGate />);
    expect(screen.getByRole('dialog', { name: /internal key required/i })).toBeInTheDocument();

    const input = screen.getByLabelText('Key');
    const unlock = screen.getByRole('button', { name: /unlock/i });
    // Nothing to send yet.
    expect(unlock).toBeDisabled();

    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_key"}', { status: 401 }));
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(unlock);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not accepted/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/session/login');
    expect(JSON.parse(init.body)).toEqual({ key: 'wrong' });

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    fireEvent.change(input, { target: { value: '  right  ' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ key: 'right' });
    expect(useInternalKeyStore.getState().locked).toBe(false);
  });
});
