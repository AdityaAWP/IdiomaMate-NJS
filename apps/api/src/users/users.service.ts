import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { Prisma } from '@db';
import { UpdateProfileDto } from './dto/update-profile.dto';

const publicSelect = {
  id: true,
  username: true,
  targetLanguage: true,
  proficiency: true,
  avatarUrl: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: dto,
        select: {
          id: true,
          email: true,
          username: true,
          targetLanguage: true,
          proficiency: true,
          avatarUrl: true,
          updatedAt: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Username already taken');
      }
      throw e;
    }
  }

  async search(q: string, requesterId: string) {
    return this.prisma.user.findMany({
      where: {
        username: { contains: q, mode: 'insensitive' },
        id: { not: requesterId },
      },
      select: publicSelect,
      take: 20,
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: publicSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
