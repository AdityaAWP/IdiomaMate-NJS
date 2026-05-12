import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { FriendRequestStatus } from '@db';

@Injectable()
export class FriendsService {
  constructor(private prisma: PrismaService) {}

  async sendRequest(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });
    if (existing)
      throw new BadRequestException('Friend request already exists');

    const alreadyFriends = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: senderId, user2Id: receiverId },
          { user1Id: receiverId, user2Id: senderId },
        ],
      },
    });
    if (alreadyFriends) throw new BadRequestException('Already friends');

    return this.prisma.friendRequest.create({
      data: { senderId, receiverId },
      select: { id: true, receiverId: true, status: true, createdAt: true },
    });
  }

  async acceptRequest(userId: string, requestId: string) {
    const request = await this.findPendingRequestForReceiver(userId, requestId);

    const [friendship] = await this.prisma.$transaction([
      this.prisma.friendship.create({
        data: { user1Id: request.senderId, user2Id: request.receiverId },
      }),
      this.prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: FriendRequestStatus.ACCEPTED },
      }),
    ]);

    return friendship;
  }

  async rejectRequest(userId: string, requestId: string) {
    await this.findPendingRequestForReceiver(userId, requestId);
    return this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: FriendRequestStatus.REJECTED },
    });
  }

  async cancelRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Friend request not found');
    if (request.senderId !== userId) throw new ForbiddenException();
    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Request already responded to');
    }
    return this.prisma.friendRequest.delete({ where: { id: requestId } });
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
      include: {
        user1: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            targetLanguage: true,
            proficiency: true,
          },
        },
        user2: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            targetLanguage: true,
            proficiency: true,
          },
        },
      },
    });

    return friendships.map((f) => ({
      friendshipId: f.id,
      friend: f.user1Id === userId ? f.user2 : f.user1,
      since: f.createdAt,
    }));
  }

  async getReceivedRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: { receiverId: userId, status: FriendRequestStatus.PENDING },
      include: {
        sender: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSentRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: { senderId: userId, status: FriendRequestStatus.PENDING },
      include: {
        receiver: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async unfriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: friendId },
          { user1Id: friendId, user2Id: userId },
        ],
      },
    });
    if (!friendship) throw new NotFoundException('Friendship not found');
    return this.prisma.friendship.delete({ where: { id: friendship.id } });
  }

  private async findPendingRequestForReceiver(
    userId: string,
    requestId: string,
  ) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Friend request not found');
    if (request.receiverId !== userId) throw new ForbiddenException();
    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Request already responded to');
    }
    return request;
  }
}
