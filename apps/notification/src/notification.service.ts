import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { WebSocket } from 'ws';
import type { MatchFoundEvent, MatchCancelEvent } from '@app/shared';
import { MetricsService } from './metrics.service';

interface RegistryEntry {
  ws: WebSocket;
  level: string;
}

@Injectable()
export class NotificationService {
  private readonly registry = new Map<string, RegistryEntry>();
  private readonly broker = process.env.BROKER ?? 'nats';

  constructor(
    @Inject('BROKER_CLIENT') private brokerClient: ClientProxy,
    private metrics: MetricsService,
  ) {}

  register(userId: string, level: string, ws: WebSocket) {
    this.registry.set(userId, { ws, level });
  }

  unregister(userId: string) {
    const entry = this.registry.get(userId);
    if (!entry) return;
    this.registry.delete(userId);

    const cancel: MatchCancelEvent = { userId, level: entry.level };
    this.brokerClient.emit('matchmaking.cancel', cancel);
  }

  handleMatchFound(event: MatchFoundEvent) {
    this.metrics.hop2.observe({ broker: this.broker }, Date.now() - event.publishedAt);

    const send = (userId: string, payload: object) => {
      const entry = this.registry.get(userId);
      if (entry?.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(JSON.stringify({ event: 'match_found', data: payload }));
      }
    };

    const basePayload = {
      channelName: event.channelName,
      user1Id: event.user1Id,
      user2Id: event.user2Id,
    };

    send(event.user1Id, {
      ...basePayload,
      token: event.tokenUser1,
      myTopics: event.topicsUser1,
      partnerTopics: event.topicsUser2,
    });

    send(event.user2Id, {
      ...basePayload,
      token: event.tokenUser2,
      myTopics: event.topicsUser2,
      partnerTopics: event.topicsUser1,
    });
  }
}
