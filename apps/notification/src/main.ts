import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { WsAdapter } from '@nestjs/platform-ws';
import { NotificationModule } from './notification.module';

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule);
  app.useWebSocketAdapter(new WsAdapter(app));

  const brokerOptions: MicroserviceOptions =
    process.env.BROKER === 'rabbitmq'
      ? {
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'],
            queue: 'notification_queue',
            queueOptions: { durable: true },
            wildcards: true,
            exchange: 'matchmaking',
            exchangeType: 'topic',
          },
        }
      : {
          transport: Transport.NATS,
          options: {
            servers: [process.env.NATS_URL ?? 'nats://localhost:4222'],
          },
        };

  app.connectMicroservice(brokerOptions);
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3002);
}
void bootstrap();
