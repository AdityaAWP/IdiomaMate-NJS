import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MatchController } from './match.controller';

const brokerClient =
  process.env.BROKER === 'rabbitmq'
    ? {
        name: 'BROKER_CLIENT',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'],
          queue: 'api_out_queue',
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
  imports: [ClientsModule.register([brokerClient as any])],
  controllers: [MatchController],
})
export class MatchModule {}
