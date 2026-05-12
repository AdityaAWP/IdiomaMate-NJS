import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { Language } from '@db';
import { CreateLobbyDto } from './dto/create-lobby.dto';

@Injectable()
export class LobbyService {
  constructor(private prisma: PrismaService) {}

  async createLobby(ownerId: string, dto: CreateLobbyDto, bannerUrl?: string) {
    return this.prisma.lobby.create({
      data: {
        ...dto,
        ownerId,
        bannerUrl: bannerUrl ?? null,
        members: {
          create: { userId: ownerId },
        },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
          },
        },
      },
    });
  }

  async getLobbies(language?: Language) {
    return this.prisma.lobby.findMany({
      where: {
        isPrivate: false,
        ...(language ? { language } : {}),
      },
      include: {
        owner: { select: { id: true, username: true, avatarUrl: true } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLobby(lobbyId: string) {
    const lobby = await this.prisma.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        owner: { select: { id: true, username: true, avatarUrl: true } },
        members: {
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!lobby) throw new NotFoundException('Lobby not found');
    return lobby;
  }

  async deleteLobby(userId: string, lobbyId: string) {
    const lobby = await this.prisma.lobby.findUnique({
      where: { id: lobbyId },
    });
    if (!lobby) throw new NotFoundException('Lobby not found');
    if (lobby.ownerId !== userId) throw new ForbiddenException();
    return this.prisma.lobby.delete({ where: { id: lobbyId } });
  }

  async joinLobby(userId: string, lobbyId: string) {
    const lobby = await this.prisma.lobby.findUnique({
      where: { id: lobbyId },
    });
    if (!lobby) throw new NotFoundException('Lobby not found');

    return this.prisma.lobbyMember.upsert({
      where: { lobbyId_userId: { lobbyId, userId } },
      create: { lobbyId, userId },
      update: {},
    });
  }

  async leaveLobby(userId: string, lobbyId: string) {
    const member = await this.prisma.lobbyMember.findUnique({
      where: { lobbyId_userId: { lobbyId, userId } },
    });
    if (!member) throw new NotFoundException('Not a member of this lobby');

    await this.prisma.lobbyMember.delete({
      where: { lobbyId_userId: { lobbyId, userId } },
    });

    // Delete lobby if no members remain
    const remaining = await this.prisma.lobbyMember.count({
      where: { lobbyId },
    });
    if (remaining === 0) {
      await this.prisma.lobby.delete({ where: { id: lobbyId } });
    }

    return { ok: true };
  }

  async getMessages(lobbyId: string, cursor?: string, limit = 50) {
    const lobby = await this.prisma.lobby.findUnique({
      where: { id: lobbyId },
    });
    if (!lobby) throw new NotFoundException('Lobby not found');

    const messages = await this.prisma.lobbyMessage.findMany({
      where: { lobbyId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    return {
      messages: messages.reverse(),
      nextCursor: hasMore ? (messages[0]?.id ?? null) : null,
    };
  }

  async sendMessage(userId: string, lobbyId: string, content: string) {
    const member = await this.prisma.lobbyMember.findUnique({
      where: { lobbyId_userId: { lobbyId, userId } },
    });
    if (!member)
      throw new ForbiddenException('You are not a member of this lobby');

    return this.prisma.lobbyMessage.create({
      data: { lobbyId, userId, content },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });
  }
}
