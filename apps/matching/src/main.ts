import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { MatchingModule } from './matching.module';

async function bootstrap() {
  // Hybrid app: HTTP for /metrics + microservice for broker events
  const app = await NestFactory.create(MatchingModule);

  const brokerOptions: MicroserviceOptions =
    process.env.BROKER === 'rabbitmq'
      ? {
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'],
            queue: 'matching_queue',
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
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
