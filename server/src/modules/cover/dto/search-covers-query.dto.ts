import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateBy } from 'class-validator';
import { isCoverSearchSourceKey } from '@bookorbit/types';

function trimQueryString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseBooleanQueryValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}

export class SearchCoversQueryDto {
  @Transform(({ value }) => trimQueryString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @Transform(({ value }) => trimQueryString(value))
  @IsString()
  @MaxLength(255)
  author?: string;

  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryValue(value))
  @IsBoolean()
  isAudiobook?: boolean;

  @IsOptional()
  @ValidateBy({ name: 'isCoverSearchSourceKey', validator: { validate: isCoverSearchSourceKey } })
  provider?: string;
}
