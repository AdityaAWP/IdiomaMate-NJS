import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DmService } from './dm.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('dm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dm')
export class DmController {
  constructor(private dmService: DmService) {}

  @ApiOperation({ summary: 'Get all conversations (inbox)' })
  @Get()
  getConversations(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.dmService.getConversations(userId);
  }

  @ApiOperation({ summary: 'Send a message to a user' })
  @Post(':userId')
  sendMessage(
    @Req() req: Request,
    @Param('userId') receiverId: string,
    @Body() dto: SendMessageDto,
  ) {
    const { userId } = req.user as { userId: string };
    return this.dmService.sendMessage(userId, receiverId, dto);
  }

  @ApiOperation({ summary: 'Get messages with a user (newest-first, cursor paginated)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 30 })
  @Get(':userId/messages')
  getMessages(
    @Req() req: Request,
    @Param('userId') otherUserId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const { userId } = req.user as { userId: string };
    return this.dmService.getMessages(userId, otherUserId, cursor, limit ? parseInt(limit, 10) : 30);
  }

  @ApiOperation({ summary: 'Mark all messages in a conversation as read' })
  @Patch(':conversationId/read')
  markRead(@Req() req: Request, @Param('conversationId') conversationId: string) {
    const { userId } = req.user as { userId: string };
    return this.dmService.markRead(userId, conversationId);
  }
}
