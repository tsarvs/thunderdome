import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { listThunderdomeContainers, removeThunderdomeContainers } from '../src/cleanup.js';

describe('listThunderdomeContainers', () => {
  it('filters on the thunderdome.matchId label and maps to a plain shape', async () => {
    const listContainers = vi.fn().mockResolvedValue([
      {
        Id: 'abc123',
        Labels: { 'thunderdome.matchId': 'm1', 'thunderdome.participantId': 'p1' },
        State: 'running',
      },
      {
        Id: 'def456',
        Labels: { 'thunderdome.matchId': 'm2', 'thunderdome.participantId': 'p2' },
        State: 'exited',
      },
    ]);
    const docker = { listContainers } as unknown as Docker;

    const result = await listThunderdomeContainers(docker);

    expect(listContainers).toHaveBeenCalledWith({
      all: true,
      filters: { label: ['thunderdome.matchId'] },
    });
    expect(result).toEqual([
      { id: 'abc123', matchId: 'm1', participantId: 'p1', state: 'running' },
      { id: 'def456', matchId: 'm2', participantId: 'p2', state: 'exited' },
    ]);
  });

  it('falls back to "unknown" for a container missing an expected label', async () => {
    const listContainers = vi
      .fn()
      .mockResolvedValue([{ Id: 'abc123', Labels: {}, State: 'running' }]);
    const docker = { listContainers } as unknown as Docker;

    const result = await listThunderdomeContainers(docker);

    expect(result).toEqual([
      { id: 'abc123', matchId: 'unknown', participantId: 'unknown', state: 'running' },
    ]);
  });
});

describe('removeThunderdomeContainers', () => {
  it('force-removes every listed container', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const getContainer = vi.fn().mockReturnValue({ remove });
    const docker = { getContainer } as unknown as Docker;

    await removeThunderdomeContainers(
      [
        { id: 'abc123', matchId: 'm1', participantId: 'p1', state: 'running' },
        { id: 'def456', matchId: 'm2', participantId: 'p2', state: 'exited' },
      ],
      docker,
    );

    expect(getContainer).toHaveBeenCalledWith('abc123');
    expect(getContainer).toHaveBeenCalledWith('def456');
    expect(remove).toHaveBeenCalledWith({ force: true });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not throw if a container is already gone', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('no such container'));
    const getContainer = vi.fn().mockReturnValue({ remove });
    const docker = { getContainer } as unknown as Docker;

    await expect(
      removeThunderdomeContainers(
        [{ id: 'abc123', matchId: 'm1', participantId: 'p1', state: 'running' }],
        docker,
      ),
    ).resolves.toBeUndefined();
  });
});
