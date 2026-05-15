import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class CancelMatchDto {
  @ApiProperty({ example: 'english.beginner' })
  @IsString()
  @IsNotEmpty()
  level: string;
}
