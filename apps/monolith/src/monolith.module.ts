import { Module } from '@nestjs/common';
import { MonolithController } from './monolith.controller';
import { MonolithService } from './monolith.service';

@Module({
  imports: [],
  controllers: [MonolithController],
  providers: [MonolithService],
})
export class MonolithModule {}
