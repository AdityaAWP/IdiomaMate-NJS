import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsString,
  MaxLength,
  ArrayMaxSize,
  IsNotEmpty,
} from 'class-validator';

export class JoinMatchDto {
  @ApiProperty({ example: 'english.beginner' })
  @IsString()
  @IsNotEmpty()
  level: string;

  @ApiProperty({ example: ['food', 'travel'], maxItems: 5 })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(5)
  topics: string[];
}
