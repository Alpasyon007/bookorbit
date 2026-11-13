import { Controller, Get, Param, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SeriesCatalogService } from '../metadata-fetch/series-catalog.service';
import { SeriesIdParamDto, SeriesPageQueryDto, SeriesSearchQueryDto } from './dto/series-catalog.dto';

@Controller('book-requests/series-catalog')
@RequirePermission(Permission.BookRequestAccess)
export class SeriesCatalogController {
  constructor(private readonly catalog: SeriesCatalogService) {}

  @Get()
  search(@Query() query: SeriesSearchQueryDto) {
    return this.catalog.search(query.q, query.offset);
  }

  @Get(':id')
  members(@Param() params: SeriesIdParamDto, @Query() query: SeriesPageQueryDto) {
    return this.catalog.members(params.id, query.offset);
  }
}
