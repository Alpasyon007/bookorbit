import { IsObject } from 'class-validator';

export class CustomPatchSettingsDto {
  @IsObject()
  settings!: Record<string, unknown>;
}
