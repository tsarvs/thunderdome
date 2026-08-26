import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import {
  listThunderdomeContainers,
  listThunderdomeImages,
  removeThunderdomeContainers,
  removeThunderdomeImages,
} from '../src/cleanup.js';

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
    expect(remove).toHaveBeenCalledWith({ force: true, v: true });
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

describe('listThunderdomeImages', () => {
  it('filters on the thunderdome-bot- tag prefix and maps to a plain shape', async () => {
    const listImages = vi.fn().mockResolvedValue([
      { Id: 'sha256:abc123', RepoTags: ['thunderdome-bot-tominator-t1:latest'] },
      {
        Id: 'sha256:def456',
        RepoTags: ['thunderdome-bot-random-hearts:latest', 'some-other-tag:latest'],
      },
    ]);
    const docker = { listImages } as unknown as Docker;

    const result = await listThunderdomeImages(docker);

    expect(listImages).toHaveBeenCalledWith({
      filters: { reference: ['thunderdome-bot-*'] },
    });
    expect(result).toEqual([
      { id: 'sha256:abc123', tags: ['thunderdome-bot-tominator-t1:latest'] },
      { id: 'sha256:def456', tags: ['thunderdome-bot-random-hearts:latest'] },
    ]);
  });

  it('falls back to an empty tags array for an image with no RepoTags', async () => {
    const listImages = vi.fn().mockResolvedValue([{ Id: 'sha256:abc123', RepoTags: null }]);
    const docker = { listImages } as unknown as Docker;

    const result = await listThunderdomeImages(docker);

    expect(result).toEqual([{ id: 'sha256:abc123', tags: [] }]);
  });
});

describe('removeThunderdomeImages', () => {
  it('force-removes every listed image', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const getImage = vi.fn().mockReturnValue({ remove });
    const docker = { getImage } as unknown as Docker;

    await removeThunderdomeImages(
      [
        { id: 'sha256:abc123', tags: ['thunderdome-bot-tominator-t1:latest'] },
        { id: 'sha256:def456', tags: ['thunderdome-bot-random-hearts:latest'] },
      ],
      docker,
    );

    expect(getImage).toHaveBeenCalledWith('sha256:abc123');
    expect(getImage).toHaveBeenCalledWith('sha256:def456');
    expect(remove).toHaveBeenCalledWith({ force: true });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not throw if an image is already gone', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('no such image'));
    const getImage = vi.fn().mockReturnValue({ remove });
    const docker = { getImage } as unknown as Docker;

    await expect(
      removeThunderdomeImages([{ id: 'sha256:abc123', tags: [] }], docker),
    ).resolves.toBeUndefined();
  });
});
