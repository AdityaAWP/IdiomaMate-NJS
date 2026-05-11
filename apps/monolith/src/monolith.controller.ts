import { Controller, Get } from '@nestjs/common';
import { MonolithService } from './monolith.service';

@Controller()
export class MonolithController {
  constructor(private readonly monolithService: MonolithService) {}

  @Get()
  getHello(): string {
    return this.monolithService.getHello();
  }
}
