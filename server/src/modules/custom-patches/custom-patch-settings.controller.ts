import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CustomPatchSettingsService } from './custom-patch-settings.service';
import { CustomPatchSettingsDto } from './dto/custom-patch-settings.dto';

@Controller('custom-patches')
export class CustomPatchSettingsController {
  constructor(private readonly settings: CustomPatchSettingsService) {}

  @Get('preferences')
  async getPreferences(@CurrentUser() user: RequestUser) {
    return { settings: await this.settings.getPreferences(user.id) };
  }

  @Put('preferences')
  @HttpCode(204)
  setPreferences(@CurrentUser() user: RequestUser, @Body() dto: CustomPatchSettingsDto) {
    return this.settings.setPreferences(user.id, dto.settings);
  }

  @Get('policy')
  async getPolicy() {
    return { settings: await this.settings.getPolicy() };
  }

  @Put('policy')
  @Auditable({ action: AuditAction.AppSettingsUpdate, resource: AuditResource.AppSettings, description: 'Updated custom patch policy' })
  @RequirePermission(Permission.ManageAppSettings)
  @HttpCode(204)
  setPolicy(@CurrentUser() user: RequestUser, @Body() dto: CustomPatchSettingsDto) {
    return this.settings.setPolicy(user.id, dto.settings);
  }
}
