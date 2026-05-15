import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import type { MatchRequestEvent, MatchCancelEvent } from '@app/shared';
import { MatchingService } from './matching.service';

@Controller()
export class MatchingController {
  private readonly logger = new Logger(MatchingController.name);

  constructor(private matchingService: MatchingService) {}

  @EventPattern('matchmaking.join')
  async handleJoin(@Payload() data: MatchRequestEvent) {
    this.logger.log(`matchmaking.join received userId=${data.userId} level=${data.level}`);
    await this.matchingService.handleJoin(data);
  }

  @EventPattern('matchmaking.cancel')
  async handleCancel(@Payload() data: MatchCancelEvent) {
    this.logger.log(`matchmaking.cancel received userId=${data.userId}`);
    await this.matchingService.handleCancel(data.userId, data.level);
  }
}
