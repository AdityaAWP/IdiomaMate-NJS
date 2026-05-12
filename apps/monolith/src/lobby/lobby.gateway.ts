import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { LobbyService } from './lobby.service';

interface AuthSocket extends Socket {
  userId: string;
}

@WebSocketGateway({ namespace: 'lobby', cors: { origin: '*' } })
export class LobbyGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private lobbyService: LobbyService,
    private jwtService: JwtService,
  ) {}

  async handleConnection(client: AuthSocket) {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) throw new UnauthorizedException();
      const payload = this.jwtService.verify<{ sub: string }>(token);
      client.userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(_client: AuthSocket) {}

  @SubscribeMessage('join_lobby')
  async handleJoinLobby(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { lobbyId: string },
  ) {
    await this.lobbyService.joinLobby(client.userId, payload.lobbyId);
    await client.join(payload.lobbyId);
    this.server.to(payload.lobbyId).emit('member_joined', { userId: client.userId });
    return { ok: true };
  }

  @SubscribeMessage('leave_lobby')
  async handleLeaveLobby(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { lobbyId: string },
  ) {
    await this.lobbyService.leaveLobby(client.userId, payload.lobbyId);
    await client.leave(payload.lobbyId);
    this.server.to(payload.lobbyId).emit('member_left', { userId: client.userId });
    return { ok: true };
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { lobbyId: string; content: string },
  ) {
    const message = await this.lobbyService.sendMessage(
      client.userId,
      payload.lobbyId,
      payload.content,
    );
    this.server.to(payload.lobbyId).emit('new_message', message);
    return message;
  }
}
