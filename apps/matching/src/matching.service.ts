import { Injectable } from '@nestjs/common';

@Injectable()
export class MatchingService {
  getHello(): string {
    return 'Hello World!';
  }
}
