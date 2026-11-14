import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CustomPatchSettingsService } from '../custom-patches/custom-patch-settings.service';
import { SeriesCatalogService } from '../metadata-fetch/series-catalog.service';
import { SeriesIdParamDto, SeriesPageQueryDto, SeriesSearchQueryDto } from './dto/series-catalog.dto';

@Controller('book-requests/series-catalog')
@RequirePermission(Permission.BookRequestAccess)
export class SeriesCatalogController {
  constructor(
    private readonly catalog: SeriesCatalogService,
    private readonly patchSettings: CustomPatchSettingsService,
  ) {}

  @Get()
  async search(@Query() query: SeriesSearchQueryDto, @CurrentUser() user: RequestUser) {
    await this.assertEnabled(user.id);
    return this.catalog.search(query.q, query.offset);
  }

  @Get(':id')
  async members(@Param() params: SeriesIdParamDto, @Query() query: SeriesPageQueryDto, @CurrentUser() user: RequestUser) {
    await this.assertEnabled(user.id);
    return this.catalog.members(params.id, query.offset);
  }

  private async assertEnabled(userId: number) {
    const [policy, preferences] = await Promise.all([this.patchSettings.getPolicy(), this.patchSettings.getPreferences(userId)]);
    if (!policy.seriesRequestsEnabled || !preferences.seriesRequests.enabled) throw new ForbiddenException('Series requests are disabled');
  }
}
