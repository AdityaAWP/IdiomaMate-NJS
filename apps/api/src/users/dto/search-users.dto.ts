import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchUsersDto {
  @ApiProperty({ example: 'john', minLength: 1 })
  @IsString()
  @MinLength(1)
  q: string;
}
