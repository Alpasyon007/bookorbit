import { Body, Controller, Post, Res } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BulkSelectionDto } from '../../common/dto/bulk-selection.dto';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { BulkRunsService } from '../bulk-runs/bulk-runs.service';

@Controller('books/bulk')
export class StoryGuidesBulkController {
  constructor(
    private readonly books: BookService,
    private readonly runs: BulkRunsService,
  ) {}

  @Post('story-guides')
  @RequirePermission(Permission.LibraryGenerateStoryGuide)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  async build(@Body() dto: BulkSelectionDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply): Promise<void> {
    const ids = await this.books.resolveSelectionToIds(dto, user);
    await this.runs.startAndStream(reply, {
      kind: 'book-build-story-guides',
      subjectIds: ids,
      actor: user,
      audit: {
        action: AuditAction.BookBulkBuildStoryGuides,
        resource: AuditResource.Book,
        description: (count) => `Bulk requested story guides for ${count} book${count !== 1 ? 's' : ''}`,
      },
    });
  }
}
