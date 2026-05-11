import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'crypto'
import * as bcrypt from 'bcryptjs'
import { Profile } from 'passport-google-oauth20'
import { PrismaService } from '@app/shared'
import { Prisma, User } from '@db'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'

@Injectable()
export class AuthService {
  private readonly refreshExpiresMs = 7 * 24 * 60 * 60 * 1000

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10)
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          username: dto.username,
          passwordHash,
          targetLanguage: dto.targetLanguage,
          proficiency: dto.proficiency,
        },
      })
      return this.generateTokens(user)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email or username already taken')
      }
      throw e
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    return this.generateTokens(user)
  }

  async refresh(token: string) {
    const tokenHash = this.hashToken(token)
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } })

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token')
    }

    await this.prisma.refreshToken.delete({ where: { id: stored.id } })
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: stored.userId } })
    return this.generateTokens(user)
  }

  async logout(token: string) {
    const tokenHash = this.hashToken(token)
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } })
  }

  async googleLogin(profile: Profile) {
    const email = profile.emails?.[0]?.value
    if (!email) throw new UnauthorizedException('No email from Google')

    let user = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: profile.id }, { email }] },
    })

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          username: profile.displayName.replace(/\s+/g, '_').toLowerCase().slice(0, 20),
          googleId: profile.id,
          avatarUrl: profile.photos?.[0]?.value,
          targetLanguage: 'english',
          proficiency: 'BEGINNER',
        },
      })
    } else if (!user.googleId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.id },
      })
    }

    return this.generateTokens(user)
  }

  async getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        targetLanguage: true,
        proficiency: true,
        avatarUrl: true,
        createdAt: true,
      },
    })
  }

  private async generateTokens(user: User) {
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email },
      { secret: this.config.getOrThrow('JWT_SECRET'), expiresIn: this.config.get('JWT_EXPIRES_IN', '15m') },
    )

    const raw = randomBytes(40).toString('hex')
    const tokenHash = this.hashToken(raw)

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + this.refreshExpiresMs),
      },
    })

    return {
      accessToken,
      refreshToken: raw,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        targetLanguage: user.targetLanguage,
        proficiency: user.proficiency,
        avatarUrl: user.avatarUrl,
      },
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }
}
