/**
 * Tests for MemoryPanel component.
 *
 * Required dev-dependencies (not yet in package.json):
 *   vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
 *
 * Add to vite.config.ts (or create vitest.config.ts):
 *   test: {
 *     globals: true,
 *     environment: 'jsdom',
 *     setupFiles: ['./src/setupTests.ts'],  // optional, for jest-dom matchers
 *   }
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryPanel } from './MemoryPanel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the zustand store used by MemoryPanel
vi.mock('@/stores', () => ({
  useUIStore: (selector: (state: { darkMode: boolean }) => unknown) =>
    selector({ darkMode: true }),
}));

// Helper to build a successful JSON Response
function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryPanel', () => {
  // -----------------------------------------------------------------------
  // 1. Renders "Memory Disabled" when config returns enabled: false
  // -----------------------------------------------------------------------
  it('renders "Memory Disabled" when config returns enabled: false', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/memory/config')) {
        return jsonResponse({ enabled: false, user_id: '' });
      }
      return jsonResponse({});
    });

    render(
      <MemoryPanel projectId="proj-1" isVisible={true} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Memory Disabled')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Renders tab bar when config returns enabled: true
  // -----------------------------------------------------------------------
  it('renders tab bar when config returns enabled: true', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/memory/config')) {
        return jsonResponse({ enabled: true, user_id: 'u1' });
      }
      // STM tab loads on mount
      if (url.includes('/api/memory/stm/')) {
        return jsonResponse({ entries: [] });
      }
      return jsonResponse({});
    });

    render(
      <MemoryPanel projectId="proj-1" isVisible={true} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Scratchpad')).toBeInTheDocument();
    });

    expect(screen.getByText('Long-Term')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByText('Stats')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 3. Shows STM entries when switching to (or viewing) Scratchpad tab
  // -----------------------------------------------------------------------
  it('shows STM entries on the Scratchpad tab', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/memory/config')) {
        return jsonResponse({ enabled: true, user_id: 'u1' });
      }
      if (url.includes('/api/memory/stm/')) {
        return jsonResponse({
          entries: [
            {
              key: 'user_lang',
              content: 'User prefers TypeScript',
              tags: ['preference'],
              created_at: '2025-01-01T00:00:00Z',
              access_count: 3,
              importance: 0.8,
            },
          ],
        });
      }
      return jsonResponse({});
    });

    render(
      <MemoryPanel projectId="proj-1" isVisible={true} onClose={vi.fn()} />,
    );

    // Scratchpad is the default tab — wait for the STM entry to appear
    await waitFor(() => {
      expect(screen.getByText('user_lang')).toBeInTheDocument();
    });

    expect(screen.getByText('User prefers TypeScript')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 4. Shows search input on LTM tab
  // -----------------------------------------------------------------------
  it('shows search input on the Long-Term tab', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/memory/config')) {
        return jsonResponse({ enabled: true, user_id: 'u1' });
      }
      if (url.includes('/api/memory/stm/')) {
        return jsonResponse({ entries: [] });
      }
      return jsonResponse({});
    });

    const user = userEvent.setup();

    render(
      <MemoryPanel projectId="proj-1" isVisible={true} onClose={vi.fn()} />,
    );

    // Wait for the panel to finish loading
    await waitFor(() => {
      expect(screen.getByText('Long-Term')).toBeInTheDocument();
    });

    // Click the Long-Term tab
    await user.click(screen.getByText('Long-Term'));

    // The LTM tab should render a search input
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/search memories/i),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Calls onClose when close button is clicked
  // -----------------------------------------------------------------------
  it('calls onClose when the close button is clicked', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/memory/config')) {
        return jsonResponse({ enabled: true, user_id: 'u1' });
      }
      if (url.includes('/api/memory/stm/')) {
        return jsonResponse({ entries: [] });
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryPanel projectId="proj-1" isVisible={true} onClose={onClose} />,
    );

    // Wait for the tab bar to render (proves config loaded)
    await waitFor(() => {
      expect(screen.getByText('Scratchpad')).toBeInTheDocument();
    });

    // The close button has title="Close"
    const closeBtn = screen.getByTitle('Close');
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Edge: returns null when isVisible is false
  // -----------------------------------------------------------------------
  it('renders nothing when isVisible is false', () => {
    render(
      <MemoryPanel projectId="proj-1" isVisible={false} onClose={vi.fn()} />,
    );

    expect(screen.queryByText('Memory')).not.toBeInTheDocument();
    expect(screen.queryByText('Memory Disabled')).not.toBeInTheDocument();
  });
});
