import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

const brokerClient = process.env.BROKER === 'rabbitmq'
  ? {
      name: 'BROKER_CLIENT',
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'],
        queue: 'matching_out_queue',
        queueOptions: { durable: true },
        wildcards: true,
        exchange: 'matchmaking',
        exchangeType: 'topic',
      },
    }
  : {
      name: 'BROKER_CLIENT',
      transport: Transport.NATS,
      options: { servers: [process.env.NATS_URL ?? 'nats://localhost:4222'] },
    };

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ClientsModule.register([brokerClient as any]),
  ],
  controllers: [MatchingController, MetricsController],
  providers: [MatchingService, MetricsService],
})
export class MatchingModule {}
