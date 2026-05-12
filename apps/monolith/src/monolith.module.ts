import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@app/shared';
import { FriendsModule } from './friends/friends.module';
import { DmModule } from './dm/dm.module';
import { LobbyModule } from './lobby/lobby.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    FriendsModule,
    DmModule,
    LobbyModule,
  ],
})
export class MonolithModule {}
