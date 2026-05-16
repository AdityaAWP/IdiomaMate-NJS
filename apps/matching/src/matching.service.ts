import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import Redis from 'ioredis';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { v4 as uuidv4 } from 'uuid';
import type { MatchRequestEvent, MatchFoundEvent } from '@app/shared';
import { MetricsService } from './metrics.service';

const JOIN_LUA = `
  local waiting = redis.call('HGET', 'pool', KEYS[1])
  if waiting then
    redis.call('HDEL', 'pool', KEYS[1])
    return waiting
  else
    redis.call('HSET', 'pool', KEYS[1], ARGV[1])
    return nil
  end
`;

const CANCEL_LUA = `
  local current = redis.call('HGET', 'pool', KEYS[1])
  if current == ARGV[1] then
    redis.call('HDEL', 'pool', KEYS[1])
  end
  return 0
`;

@Injectable()
export class MatchingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchingService.name);
  private redis: Redis;
  private readonly broker = process.env.BROKER ?? 'nats';

  constructor(
    @Inject('BROKER_CLIENT') private brokerClient: ClientProxy,
    private metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async handleJoin(event: MatchRequestEvent): Promise<void> {
    this.logger.log(`handleJoin userId=${event.userId} level=${event.level}`);
    this.metrics.matchRequestsTotal.inc({ broker: this.broker });
    this.metrics.hop1.observe(
      { broker: this.broker },
      Date.now() - event.publishedAt,
    );

    const payload = JSON.stringify({
      userId: event.userId,
      topics: event.topics,
    });
    const partner = (await this.redis.eval(
      JOIN_LUA,
      1,
      event.level,
      payload,
    )) as string | null;
    this.logger.log(
      `Redis result for level=${event.level}: partner=${partner ? 'FOUND' : 'null (waiting)'}`,
    );

    if (!partner) return;

    const waiting = JSON.parse(partner) as { userId: string; topics: string[] };

    const channelName = `match_${uuidv4()}`;
    const tokenUser1 = this.generateAgoraToken(channelName, 1);
    const tokenUser2 = this.generateAgoraToken(channelName, 2);

    const found: MatchFoundEvent = {
      user1Id: waiting.userId,
      user2Id: event.userId,
      channelName,
      tokenUser1,
      tokenUser2,
      topicsUser1: waiting.topics,
      topicsUser2: event.topics,
      publishedAt: Date.now(),
    };

    this.logger.log(
      `Publishing match.found for ${found.user1Id} + ${found.user2Id}`,
    );
    this.brokerClient.emit('match.found', found);
    this.metrics.matchesTotal.inc({ broker: this.broker });
  }

  async handleCancel(userId: string, level: string): Promise<void> {
    // Cancel uses userId as ARGV so the Lua compares exact stored payload
    // We scan the pool for any entry belonging to this user at this level
    const stored = await this.redis.hget('pool', level);
    if (!stored) return;
    try {
      const entry = JSON.parse(stored) as { userId: string };
      if (entry.userId === userId) {
        await this.redis.hdel('pool', level);
      }
    } catch {
      // stored value is not valid JSON, skip
    }
  }

  private generateAgoraToken(channelName: string, uid: number): string {
    const appId = process.env.AGORA_APP_ID ?? 'placeholder_app_id';
    const appCert =
      process.env.AGORA_APP_CERTIFICATE ?? 'placeholder_certificate';
    const expireAt = Math.floor(Date.now() / 1000) + 3600;
    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCert,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expireAt,
      expireAt,
    );
  }
}
