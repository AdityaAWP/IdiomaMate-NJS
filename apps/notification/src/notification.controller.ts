import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import type { MatchFoundEvent } from '@app/shared';
import { NotificationService } from './notification.service';

@Controller()
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private notificationService: NotificationService) {}

  @EventPattern('match.found')
  handleMatchFound(@Payload() event: MatchFoundEvent) {
    this.logger.log(`match.found received for ${event.user1Id} + ${event.user2Id}`);
    this.notificationService.handleMatchFound(event);
  }
}
