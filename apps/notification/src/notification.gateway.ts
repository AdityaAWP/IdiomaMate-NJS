import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { NotificationService } from './notification.service';

interface AuthSocket extends WebSocket {
  userId?: string;
}

@WebSocketGateway({ path: '/ws' })
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private notificationService: NotificationService,
    private jwtService: JwtService,
  ) {}

  handleConnection(client: AuthSocket, req: import('http').IncomingMessage) {
    try {
      const url = new URL(req.url ?? '', `http://localhost`);
      const token =
        url.searchParams.get('token') ??
        (req.headers.authorization as string)?.replace('Bearer ', '');

      if (!token) {
        client.close(1008, 'Unauthorized');
        return;
      }

      const payload = this.jwtService.verify<{ sub: string }>(token);
      client.userId = payload.sub;
    } catch {
      client.close(1008, 'Unauthorized');
    }
  }

  handleDisconnect(client: AuthSocket) {
    if (client.userId) {
      this.notificationService.unregister(client.userId);
    }
  }

  // Client sends: { "event": "register", "data": { "level": "english.beginner" } }
  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { level: string },
  ) {
    if (!client.userId) return;
    this.notificationService.register(client.userId, data.level, client);
  }
}
