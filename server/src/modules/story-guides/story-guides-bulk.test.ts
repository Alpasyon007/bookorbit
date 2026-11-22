import { NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { StoryGuidesBulkController } from './story-guides-bulk.controller';
import { StoryGuidesBulkHandler } from './story-guides-bulk.handler';
import { StoryGuidesService } from './story-guides.service';

const actor = { id: 7, active: true, permissions: [Permission.LibraryGenerateStoryGuide] } as never;

describe('bulk story guides', () => {
  it('resolves a scoped query before starting a persisted run', async () => {
    const books = { resolveSelectionToIds: vi.fn().mockResolvedValue([2, 4]) };
    const runs = { startAndStream: vi.fn().mockResolvedValue(undefined) };
    const controller = new StoryGuidesBulkController(books as never, runs as never);
    const selection = { query: { libraryId: 3 } };
    const reply = {} as never;
    await controller.build(selection, actor, reply);
    expect(books.resolveSelectionToIds).toHaveBeenCalledWith(selection, actor);
    expect(runs.startAndStream).toHaveBeenCalledWith(reply, expect.objectContaining({ kind: 'book-build-story-guides', subjectIds: [2, 4], actor }));
    books.resolveSelectionToIds.mockRejectedValueOnce(new NotFoundException());
    await expect(controller.build({ bookIds: [9] }, actor, reply)).rejects.toBeInstanceOf(NotFoundException);
    expect(runs.startAndStream).toHaveBeenCalledTimes(1);
  });

  it('reports queued and skipped items and the persisted totals', async () => {
    const registry = { register: vi.fn() };
    const guides = { buildMissing: vi.fn().mockResolvedValueOnce('queued').mockResolvedValueOnce('skipped') };
    const handler = new StoryGuidesBulkHandler(registry as never, guides as never);
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
    const context = { actor } as never;
    expect(await handler.processItem(1, context)).toEqual({ outcome: 'succeeded', event: { bookId: 1, status: 'queued' } });
    expect(await handler.processItem(2, context)).toEqual({ outcome: 'skipped', code: 'ineligible', event: { bookId: 2, status: 'skipped' } });
    expect(handler.doneEvent({ succeeded: 1, skipped: 2, failed: 3 } as never)).toEqual({ done: true, queued: 1, skipped: 2, failed: 3 });
  });

  it('uses ordinary build eligibility and skips lost access', async () => {
    const books = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
    const jobs = { request: vi.fn().mockResolvedValue({ kind: 'created' }) };
    const service = new StoryGuidesService(
      {} as never,
      jobs as never,
      {} as never,
      {} as never,
      books as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service as never, 'pickFile').mockResolvedValue({ id: 12 } as never);
    expect(await service.buildMissing(4, actor)).toBe('queued');
    expect(jobs.request).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'build', onlyIfMissing: true, actor, subjectRef: { bookId: 4, fileId: 12 } }),
    );
    jobs.request.mockResolvedValueOnce({ kind: 'conflict' }).mockResolvedValueOnce({ kind: 'refused' });
    expect(await service.buildMissing(4, actor)).toBe('skipped');
    expect(await service.buildMissing(4, actor)).toBe('skipped');
    books.verifyBookAccess.mockRejectedValueOnce(new NotFoundException());
    expect(await service.buildMissing(4, actor)).toBe('skipped');
  });
});
