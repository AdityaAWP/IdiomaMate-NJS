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
import { DmService } from './dm.service';
import { SendMessageDto } from './dto/send-message.dto';

interface AuthSocket extends Socket {
  userId: string;
}

@WebSocketGateway({ namespace: 'dm', cors: { origin: '*' } })
export class DmGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private dmService: DmService,
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

      // Join a personal room to receive incoming messages
      await client.join(`user:${client.userId}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthSocket) {
    client.leave(`user:${client.userId}`);
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { receiverId: string; content: string },
  ) {
    const dto: SendMessageDto = { content: payload.content };
    const message = await this.dmService.sendMessage(
      client.userId,
      payload.receiverId,
      dto,
    );

    // Deliver to receiver's personal room (and back to sender for multi-device)
    this.server.to(`user:${payload.receiverId}`).emit('new_message', message);
    this.server.to(`user:${client.userId}`).emit('new_message', message);

    return message;
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { conversationId: string },
  ) {
    return this.dmService.markRead(client.userId, payload.conversationId);
  }
}
