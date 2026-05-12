import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { LobbyService } from './lobby.service';
import { CreateLobbyDto } from './dto/create-lobby.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Language } from '@db';

@ApiTags('lobbies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lobbies')
export class LobbyController {
  constructor(private lobbyService: LobbyService) {}

  @ApiOperation({ summary: 'Create a lobby with optional banner image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        language: { type: 'string', enum: Object.values(Language) },
        isPrivate: { type: 'boolean' },
        banner: { type: 'string', format: 'binary' },
      },
      required: ['name', 'language'],
    },
  })
  @Post()
  @UseInterceptors(
    FileInterceptor('banner', {
      storage: diskStorage({
        destination: './uploads/lobbies',
        filename: (_, file, cb) =>
          cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        if (!file.mimetype.match(/^image\//)) {
          return cb(new Error('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  createLobby(
    @Req() req: Request,
    @Body() dto: CreateLobbyDto,
    @UploadedFile() banner?: Express.Multer.File,
  ) {
    const { userId } = req.user as { userId: string };
    const bannerUrl = banner
      ? `/uploads/lobbies/${banner.filename}`
      : undefined;
    return this.lobbyService.createLobby(userId, dto, bannerUrl);
  }

  @ApiOperation({
    summary: 'List public lobbies, optionally filtered by language',
  })
  @ApiQuery({ name: 'language', enum: Language, required: false })
  @Get()
  getLobbies(@Query('language') language?: Language) {
    return this.lobbyService.getLobbies(language);
  }

  @ApiOperation({ summary: 'Get lobby detail and members' })
  @Get(':id')
  getLobby(@Param('id') id: string) {
    return this.lobbyService.getLobby(id);
  }

  @ApiOperation({ summary: 'Delete a lobby (owner only)' })
  @Delete(':id')
  @HttpCode(204)
  deleteLobby(@Req() req: Request, @Param('id') id: string) {
    const { userId } = req.user as { userId: string };
    return this.lobbyService.deleteLobby(userId, id);
  }

  @ApiOperation({ summary: 'Join a lobby' })
  @Post(':id/join')
  joinLobby(@Req() req: Request, @Param('id') id: string) {
    const { userId } = req.user as { userId: string };
    return this.lobbyService.joinLobby(userId, id);
  }

  @ApiOperation({ summary: 'Leave a lobby' })
  @Delete(':id/leave')
  leaveLobby(@Req() req: Request, @Param('id') id: string) {
    const { userId } = req.user as { userId: string };
    return this.lobbyService.leaveLobby(userId, id);
  }

  @ApiOperation({ summary: 'Get lobby message history (cursor paginated)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @Get(':id/messages')
  getMessages(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.lobbyService.getMessages(
      id,
      cursor,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
