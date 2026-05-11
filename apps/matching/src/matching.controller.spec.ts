import { Test, TestingModule } from '@nestjs/testing';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

describe('MatchingController', () => {
  let matchingController: MatchingController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [MatchingController],
      providers: [MatchingService],
    }).compile();

    matchingController = app.get<MatchingController>(MatchingController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(matchingController.getHello()).toBe('Hello World!');
    });
  });
});
