import { Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { UserPreferencesModule } from '../user-preferences/user-preferences.module';
import { CustomPatchSettingsController } from './custom-patch-settings.controller';
import { CustomPatchSettingsService } from './custom-patch-settings.service';

@Module({
  imports: [AppSettingsModule, UserPreferencesModule],
  controllers: [CustomPatchSettingsController],
  providers: [CustomPatchSettingsService],
  exports: [CustomPatchSettingsService],
})
export class CustomPatchSettingsModule {}
