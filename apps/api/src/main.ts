import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { ApiModule } from './api.module'

async function bootstrap() {
  const app = await NestFactory.create(ApiModule)
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
  app.enableCors()

  const config = new DocumentBuilder()
    .setTitle('Idiomamate API')
    .setDescription('Language exchange matchmaking platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document)

  await app.listen(3000)
}
void bootstrap()
