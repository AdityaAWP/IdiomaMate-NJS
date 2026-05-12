import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @ApiOperation({ summary: 'Update own profile' })
  @Patch('profile')
  updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const user = req.user as { userId: string };
    return this.usersService.updateProfile(user.userId, dto);
  }

  @ApiOperation({ summary: 'Search users by username' })
  @Get('search')
  search(@Req() req: Request, @Query() query: SearchUsersDto) {
    const user = req.user as { userId: string };
    return this.usersService.search(query.q, user.userId);
  }

  @ApiOperation({ summary: 'Get public profile by user ID' })
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
