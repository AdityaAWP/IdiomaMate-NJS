import { Module } from '@nestjs/common';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  imports: [],
  controllers: [MatchingController],
  providers: [MatchingService],
})
export class MatchingModule {}
