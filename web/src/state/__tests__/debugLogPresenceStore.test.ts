import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../storage/debugLogHandles', () => ({ getAllDebugLogHandleHashes: vi.fn(async () => []) }));
vi.mock('../../storage/debugLogAccess', () => ({ getStashedDebugLogHashes: vi.fn(() => []) }));

import { getAllDebugLogHandleHashes } from '../../storage/debugLogHandles';
import { getStashedDebugLogHashes } from '../../storage/debugLogAccess';
import { useDebugPresenceStore } from '../debugLogPresenceStore';

const persistedMock = getAllDebugLogHandleHashes as unknown as ReturnType<typeof vi.fn>;
const stashMock = getStashedDebugLogHashes as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => useDebugPresenceStore.setState({ hashes: new Set() }));

describe('debugLogPresenceStore', () => {
  it('refresh unions persisted handle hashes and session stash hashes (deduped)', async () => {
    persistedMock.mockResolvedValue(['h1', 'h2']);
    stashMock.mockReturnValue(['h2', 'h3']);
    await useDebugPresenceStore.getState().refresh();
    expect([...useDebugPresenceStore.getState().hashes].sort()).toEqual(['h1', 'h2', 'h3']);
  });

  it('refresh yields an empty set when neither source has anything', async () => {
    persistedMock.mockResolvedValue([]);
    stashMock.mockReturnValue([]);
    await useDebugPresenceStore.getState().refresh();
    expect(useDebugPresenceStore.getState().hashes.size).toBe(0);
  });
});
