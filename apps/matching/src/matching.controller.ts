import { Controller, Get } from '@nestjs/common';
import { MatchingService } from './matching.service';

@Controller()
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get()
  getHello(): string {
    return this.matchingService.getHello();
  }
}
