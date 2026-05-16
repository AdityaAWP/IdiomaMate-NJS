import {
  Body,
  Controller,
  HttpCode,
  Logger,
  OnModuleInit,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Request } from 'express';
import type { MatchRequestEvent, MatchCancelEvent } from '@app/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JoinMatchDto } from './dto/join-match.dto';
import { CancelMatchDto } from './dto/cancel-match.dto';

@ApiTags('match')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('match')
export class MatchController implements OnModuleInit {
  private readonly logger = new Logger(MatchController.name);

  constructor(@Inject('BROKER_CLIENT') private brokerClient: ClientProxy) {}

  async onModuleInit() {
    try {
      await this.brokerClient.connect();
      this.logger.log('BROKER_CLIENT connected');
    } catch (err) {
      this.logger.error('BROKER_CLIENT connect failed', err);
    }
  }

  @ApiOperation({ summary: 'Join matchmaking queue' })
  @ApiResponse({
    status: 202,
    description: 'Queued — await match_found via WebSocket',
  })
  @Post('join')
  @HttpCode(202)
  joinMatch(@Req() req: Request, @Body() dto: JoinMatchDto) {
    const { userId } = req.user as { userId: string };

    const event: MatchRequestEvent = {
      userId,
      level: dto.level,
      topics: dto.topics,
      publishedAt: Date.now(),
    };

    this.logger.log(
      `emit matchmaking.join for userId=${userId} level=${dto.level}`,
    );
    this.brokerClient.emit('matchmaking.join', event).subscribe({
      error: (err) => this.logger.error('emit error', err),
    });
    return { status: 'queued', level: dto.level };
  }

  @ApiOperation({ summary: 'Cancel matchmaking' })
  @Post('cancel')
  @HttpCode(200)
  cancelMatch(@Req() req: Request, @Body() dto: CancelMatchDto) {
    const { userId } = req.user as { userId: string };

    const event: MatchCancelEvent = { userId, level: dto.level };
    this.brokerClient.emit('matchmaking.cancel', event).subscribe({
      error: (err) => this.logger.error('emit cancel error', err),
    });
    return { status: 'cancelled' };
  }
}
