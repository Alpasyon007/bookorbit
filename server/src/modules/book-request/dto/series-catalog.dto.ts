import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SeriesPageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset = 0;
}
export class SeriesSearchQueryDto extends SeriesPageQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;
}
export class SeriesIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  id!: number;
}
