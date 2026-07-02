import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.gateway';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PrismaModule } from '@app/shared';

const brokerClient = process.env.BROKER === 'rabbitmq'
  ? {
      name: 'BROKER_CLIENT',
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'],
        queue: 'notification_out_queue',
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
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    ClientsModule.register([brokerClient as any]),
    PrismaModule,
  ],
  controllers: [NotificationController, MetricsController],
  providers: [NotificationService, NotificationGateway, MetricsService],
})
export class NotificationModule {}
