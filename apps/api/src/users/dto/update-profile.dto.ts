import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Language, Proficiency } from '@db';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'john_doe', minLength: 3, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  username?: string;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  targetLanguage?: Language;

  @ApiPropertyOptional({ enum: Proficiency })
  @IsOptional()
  @IsEnum(Proficiency)
  proficiency?: Proficiency;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
