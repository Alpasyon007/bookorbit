import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES, type CustomPatchPolicy, type CustomPatchPreferences } from '@bookorbit/types';
import { CUSTOM_PATCH_POLICY_KEY } from '../../common/constants/app-settings.constants';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { UserPreferencesService } from '../user-preferences/user-preferences.service';
import { customPatchPolicySchema, customPatchPreferencesSchema } from './custom-patch-settings.schema';

@Injectable()
export class CustomPatchSettingsService {
  private readonly logger = new Logger(CustomPatchSettingsService.name);
  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly preferences: UserPreferencesService,
  ) {}

  async getPolicy(): Promise<CustomPatchPolicy> {
    const stored = await this.appSettings.getValue(CUSTOM_PATCH_POLICY_KEY);
    if (stored === null) return structuredClone(DEFAULT_CUSTOM_PATCH_POLICY);
    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch {
      throw new InternalServerErrorException('Stored custom patch policy is invalid');
    }
    const result = customPatchPolicySchema.safeParse(value);
    if (!result.success) throw new InternalServerErrorException('Stored custom patch policy is invalid or unsupported');
    return result.data;
  }

  async setPolicy(userId: number, settings: unknown): Promise<void> {
    const result = customPatchPolicySchema.safeParse(settings);
    if (!result.success) throw new BadRequestException('Invalid custom patch policy');
    const start = Date.now();
    this.logger.log(`[custom_patch.policy] [start] userId=${userId} - update policy started`);
    try {
      await this.appSettings.setValue(CUSTOM_PATCH_POLICY_KEY, JSON.stringify(result.data));
      this.logger.log(`[custom_patch.policy] [end] userId=${userId} durationMs=${Date.now() - start} - update policy completed`);
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.error(
        `[custom_patch.policy] [fail] userId=${userId} durationMs=${Date.now() - start} errorClass=${errorClass} error="policy update failed" - update policy failed`,
      );
      throw error;
    }
  }

  async getPreferences(userId: number): Promise<CustomPatchPreferences> {
    const stored = await this.preferences.getCustomPatchSettings(userId);
    if (stored === null) return structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES);
    const result = customPatchPreferencesSchema.safeParse(stored);
    if (!result.success) throw new InternalServerErrorException('Stored custom patch preferences are invalid or unsupported');
    return result.data;
  }

  async setPreferences(userId: number, settings: unknown): Promise<void> {
    const result = customPatchPreferencesSchema.safeParse(settings);
    if (!result.success) throw new BadRequestException('Invalid custom patch preferences');
    await this.preferences.setCustomPatchSettings(userId, result.data);
  }
}
