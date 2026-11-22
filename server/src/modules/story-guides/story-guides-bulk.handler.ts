import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { BulkRunRow } from '../../db/schema';
import type { BulkItemOutcome, BulkRunHandler, BulkRunItemContext } from '../bulk-runs/bulk-run-handler';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { StoryGuidesService } from './story-guides.service';

@Injectable()
export class StoryGuidesBulkHandler implements BulkRunHandler<null>, OnModuleInit {
  readonly kind = 'book-build-story-guides' as const;
  constructor(
    private readonly registry: BulkRunHandlerRegistry,
    private readonly guides: StoryGuidesService,
  ) {}
  onModuleInit(): void {
    this.registry.register(this);
  }
  prepare(): Promise<{ state: null }> {
    return Promise.resolve({ state: null });
  }
  startEvent(run: BulkRunRow): object {
    return { started: true, total: run.total };
  }
  async processItem(id: number, { actor }: BulkRunItemContext<null>): Promise<BulkItemOutcome> {
    const result = await this.guides.buildMissing(id, actor);
    return result === 'queued'
      ? { outcome: 'succeeded', event: { bookId: id, status: 'queued' } }
      : { outcome: 'skipped', code: 'ineligible', event: { bookId: id, status: 'skipped' } };
  }
  async finish(): Promise<void> {}
  doneEvent(run: BulkRunRow): object {
    return { done: true, queued: run.succeeded, skipped: run.skipped, failed: run.failed };
  }
}
