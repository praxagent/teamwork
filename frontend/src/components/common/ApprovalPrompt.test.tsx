/**
 * The approval dialog: invisible with nothing pending; with a pending request
 * it shows what is being asked and sends the person's decision — with its
 * scope — to the human route, never anywhere the agent reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ApprovalPrompt } from './ApprovalPrompt';

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

const PENDING = {
  approval_id: 'a1',
  capability: 'prax.tool.send_email',
  requested_by: 'prax',
  payload: { tool: 'send_email', args: { to: 'x@example.com' } },
  reason: 'HIGH-risk tool',
  created_at: null,
  expires_at: null,
};

function respond(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ApprovalPrompt', () => {
  it('renders nothing when nothing is pending', async () => {
    fetchMock.mockImplementation(() => respond({ pending: [] }));
    const { container } = render(<ApprovalPrompt />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/approvals/pending'));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the request and sends "allow once" to the human route', async () => {
    fetchMock.mockImplementation((url: string) =>
      url === '/api/approvals/pending' ? respond({ pending: [PENDING] }) : respond({ status: 'approved' }));
    render(<ApprovalPrompt />);
    expect(await screen.findByRole('dialog', { name: /prax is asking for approval/i })).toBeInTheDocument();
    expect(screen.getByText('send_email')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/approvals/a1/decide', expect.objectContaining({ method: 'POST' })));
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/approvals/a1/decide');
    expect(JSON.parse(call![1].body)).toEqual({ approve: true, scope: 'once' });
  });

  it('sends a one-hour scope and a denial correctly', async () => {
    // A server that remembers decisions: a decided request stops being pending.
    let queue = [PENDING, { ...PENDING, approval_id: 'a2' }];
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/approvals/pending') return respond({ pending: queue });
      const id = url.split('/')[3];
      queue = queue.filter((p) => p.approval_id !== id);
      return respond({});
    });
    render(<ApprovalPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: /allow for 1 hour/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/approvals/a1/decide')).toBe(true));
    const hour = fetchMock.mock.calls.find((c) => c[0] === '/api/approvals/a1/decide');
    expect(JSON.parse(hour![1].body)).toEqual({ approve: true, scope: 'hour' });

    fireEvent.click(await screen.findByRole('button', { name: /deny/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/approvals/a2/decide')).toBe(true));
    const deny = fetchMock.mock.calls.find((c) => c[0] === '/api/approvals/a2/decide');
    expect(JSON.parse(deny![1].body)).toEqual({ approve: false, scope: 'once' });
  });
});
