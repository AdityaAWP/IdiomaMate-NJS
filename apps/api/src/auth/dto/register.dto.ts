import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Proficiency } from '@db'

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string

  @ApiProperty({ example: 'john_doe', minLength: 3, maxLength: 20 })
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  username: string

  @ApiProperty({ example: 'secret123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string

  @ApiProperty({ example: 'english' })
  @IsString()
  targetLanguage: string

  @ApiProperty({ enum: Proficiency, example: Proficiency.BEGINNER })
  @IsEnum(Proficiency)
  proficiency: Proficiency
}
