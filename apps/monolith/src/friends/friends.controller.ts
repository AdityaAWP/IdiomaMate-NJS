import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  @ApiOperation({ summary: 'Get friend list' })
  @Get()
  getFriends(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.getFriends(userId);
  }

  @ApiOperation({ summary: 'Get received pending requests' })
  @Get('requests/received')
  getReceivedRequests(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.getReceivedRequests(userId);
  }

  @ApiOperation({ summary: 'Get sent pending requests' })
  @Get('requests/sent')
  getSentRequests(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.getSentRequests(userId);
  }

  @ApiOperation({ summary: 'Send friend request' })
  @Post('request/:userId')
  sendRequest(@Req() req: Request, @Param('userId') receiverId: string) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.sendRequest(userId, receiverId);
  }

  @ApiOperation({ summary: 'Accept friend request' })
  @Patch('requests/:requestId/accept')
  acceptRequest(@Req() req: Request, @Param('requestId') requestId: string) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.acceptRequest(userId, requestId);
  }

  @ApiOperation({ summary: 'Reject friend request' })
  @Patch('requests/:requestId/reject')
  rejectRequest(@Req() req: Request, @Param('requestId') requestId: string) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.rejectRequest(userId, requestId);
  }

  @ApiOperation({ summary: 'Cancel sent friend request' })
  @Delete('requests/:requestId')
  cancelRequest(@Req() req: Request, @Param('requestId') requestId: string) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.cancelRequest(userId, requestId);
  }

  @ApiOperation({ summary: 'Unfriend' })
  @Delete(':userId')
  @HttpCode(204)
  unfriend(@Req() req: Request, @Param('userId') friendId: string) {
    const { userId } = req.user as { userId: string };
    return this.friendsService.unfriend(userId, friendId);
  }
}
