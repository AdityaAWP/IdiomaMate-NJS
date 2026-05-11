import { NestFactory } from '@nestjs/core';
import { MonolithModule } from './monolith.module';

async function bootstrap() {
  const app = await NestFactory.create(MonolithModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
