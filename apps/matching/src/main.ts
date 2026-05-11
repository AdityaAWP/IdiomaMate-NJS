import { NestFactory } from '@nestjs/core';
import { MatchingModule } from './matching.module';

async function bootstrap() {
  const app = await NestFactory.create(MatchingModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
