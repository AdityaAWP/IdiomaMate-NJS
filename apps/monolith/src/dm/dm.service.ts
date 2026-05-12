import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class DmService {
  constructor(private prisma: PrismaService) {}

  async sendMessage(senderId: string, receiverId: string, dto: SendMessageDto) {
    if (senderId === receiverId) {
      throw new BadRequestException('Cannot message yourself');
    }

    const areFriends = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: senderId, user2Id: receiverId },
          { user1Id: receiverId, user2Id: senderId },
        ],
      },
    });
    if (!areFriends)
      throw new ForbiddenException('You are not friends with this user');

    const conversation = await this.getOrCreateConversation(
      senderId,
      receiverId,
    );

    return this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        content: dto.content,
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        createdAt: true,
        readAt: true,
      },
    });
  }

  async getMessages(
    userId: string,
    otherUserId: string,
    cursor?: string,
    limit = 30,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: otherUserId },
          { user1Id: otherUserId, user2Id: userId },
        ],
      },
    });
    if (!conversation) return { messages: [], nextCursor: null };

    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        senderId: true,
        content: true,
        createdAt: true,
        readAt: true,
      },
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    return {
      messages: messages.reverse(),
      nextCursor: hasMore ? (messages[0]?.id ?? null) : null,
    };
  }

  async getConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
        messages: { some: {} },
      },
      include: {
        user1: { select: { id: true, username: true, avatarUrl: true } },
        user2: { select: { id: true, username: true, avatarUrl: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            senderId: true,
            content: true,
            createdAt: true,
            readAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return conversations.map((c) => ({
      conversationId: c.id,
      contact: c.user1Id === userId ? c.user2 : c.user1,
      lastMessage: c.messages[0] ?? null,
    }));
  }

  async markRead(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
      throw new ForbiddenException();
    }

    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    return { ok: true };
  }

  private async getOrCreateConversation(user1Id: string, user2Id: string) {
    // Canonical ordering so @@unique([user1Id, user2Id]) is consistent
    const [a, b] = [user1Id, user2Id].sort();

    return this.prisma.conversation.upsert({
      where: { user1Id_user2Id: { user1Id: a, user2Id: b } },
      create: { user1Id: a, user2Id: b },
      update: {},
    });
  }
}
