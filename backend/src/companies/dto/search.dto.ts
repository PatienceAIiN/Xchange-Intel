import { IsString, MinLength, IsOptional, IsBoolean } from 'class-validator';

export class SearchDto {
  @IsString()
  @MinLength(2)
  query: string;

  // force a fresh live lookup, ignoring the DB cache
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}
