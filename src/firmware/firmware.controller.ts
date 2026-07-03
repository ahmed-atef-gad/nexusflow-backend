/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiConsumes,
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { basename, extname } from 'path';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import type { Response, Request } from 'express';
import { AuthGuard } from '../guards/auth/auth.guard';
import { RolesGuard } from '../guards/auth/roles.guard';
import { DeviceAuthGuard } from '../guards/device-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../users/enums/role.enum';
import { UploadFirmwareDto } from './dto/upload-firmware.dto';
import { FirmwareService } from './firmware.service';
import type { UploadedFirmwareFile } from './firmware.service';
import { FIRMWARE_UPLOAD_DIR } from './firmware.constants';

type FirmwareUploadRequest = Request & {
  user?: { sub?: string };
};

type FirmwareUpdateRequest = Pick<Request, 'headers' | 'protocol' | 'get'>;
type FirmwareUploadFile = {
  originalname: string;
};

@ApiTags('Firmware')
@Controller('firmware')
export class FirmwareController {
  constructor(private readonly firmwareService: FirmwareService) {}

  @ApiOperation({
    summary: 'Upload firmware binary (.bin)',
    description:
      'Uploads a new firmware binary and marks it as the latest active release. Admin only: accessible by Admin or Owner.',
  })
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['version', 'file'],
      properties: {
        version: { type: 'string', example: '1.0.0' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Firmware uploaded successfully' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (
          _request: Request,
          _file: FirmwareUploadFile,
          callback: (error: Error | null, destination: string) => void
        ) => {
          if (!existsSync(FIRMWARE_UPLOAD_DIR)) {
            mkdirSync(FIRMWARE_UPLOAD_DIR, { recursive: true });
          }
          callback(null, FIRMWARE_UPLOAD_DIR);
        },
        filename: (
          _request: Request,
          file: FirmwareUploadFile,
          callback: (error: Error | null, filename: string) => void
        ) => {
          const extension = extname(file.originalname).toLowerCase();
          const baseName = basename(file.originalname, extension).replace(
            /[^a-zA-Z0-9_-]/g,
            '_'
          );
          const uniqueName = `${Date.now()}-${baseName}${extension}`;
          callback(null, uniqueName);
        },
      }),
      fileFilter: (
        _request: Request,
        file: FirmwareUploadFile,
        callback: (error: Error | null, acceptFile: boolean) => void
      ) => {
        const extension = extname(file.originalname).toLowerCase();
        if (extension !== '.bin') {
          // multer expects an Error instance in the callback — use a plain Error to satisfy types
          // multer expects an Error instance in the callback — suppress type lint for this call

          return callback(
            new Error('Only .bin firmware files are allowed'),
            false
          );
        }
        callback(null, true);
      },
      limits: { fileSize: 32 * 1024 * 1024 },
    })
  )
  @Post('admin/upload')
  async uploadFirmware(
    @UploadedFile() file: UploadedFirmwareFile,
    @Body() body: UploadFirmwareDto,
    @Req() req: FirmwareUploadRequest
  ) {
    if (!file) {
      throw new BadRequestException('Firmware file is required');
    }

    const firmware = await this.firmwareService.uploadFirmware(
      file,
      body.version,
      req.user?.sub
    );

    return {
      id: firmware._id,
      version: firmware.version,
      checksum: firmware.checksum,
      size: firmware.size,
      uploadedAt: firmware.createdAt,
    };
  }

  @ApiOperation({
    summary: 'Delete firmware by ID',
    description:
      'Deletes firmware metadata and removes its binary file from server storage. Admin only: accessible by Admin or Owner.',
  })
  @ApiBearerAuth('access-token')
  @ApiParam({
    name: 'id',
    description: 'Firmware MongoDB ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({ status: 200, description: 'Firmware deleted successfully' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Delete('admin/:id')
  async deleteFirmware(@Param('id') firmwareId: string) {
    return this.firmwareService.deleteFirmware(firmwareId);
  }

  @ApiOperation({
    summary: 'Get firmware deployment history',
    description:
      'Returns paginated firmware deployments, sorted by creation date with the newest release first. Admin only: accessible by Admin or Owner.',
  })
  @ApiBearerAuth('access-token')
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number, starts from 1',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page, max 100',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Firmware deployment history retrieved successfully',
    schema: {
      example: {
        data: [
          {
            _id: '507f1f77bcf86cd799439011',
            version: '1.2.0',
            originalFileName: 'nexusflow-1.2.0.bin',
            storedFileName: '1720089600000-nexusflow-1_2_0.bin',
            checksum:
              'a3b1c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef01',
            size: 1048576,
            uploadedBy: '507f1f77bcf86cd799439012',
            isActive: true,
            createdAt: '2026-07-04T10:15:00.000Z',
            updatedAt: '2026-07-04T10:15:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    },
  })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('admin/history')
  async getFirmwareHistory(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined
  ) {
    return this.firmwareService.getFirmwareHistory({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @ApiOperation({
    summary: 'Check if a newer firmware is available',
    description:
      'Checks the latest uploaded firmware against the device current version.',
  })
  @ApiSecurity('device-token')
  @ApiHeader({
    name: 'Authorization',
    description: 'Device Bearer token (format: Bearer <tokenId.secret>)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Firmware update availability status',
  })
  @UseGuards(DeviceAuthGuard)
  @Get('device/check')
  async checkForUpdate(
    @Query('currentVersion') currentVersion: string | undefined,
    @Req() req: FirmwareUpdateRequest
  ) {
    return this.firmwareService.checkForUpdate(currentVersion, req);
  }

  @ApiOperation({
    summary: 'Download latest firmware binary',
    description: 'Downloads the latest active firmware binary (.bin file).',
  })
  @ApiResponse({
    status: 200,
    description: 'Firmware binary stream',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many download requests. Please try again later.',
  })
  @Throttle({ default: { limit: 3, ttl: 60 * 1000 } })
  @Get('device/download')
  async downloadLatestFirmware(@Res() res: Response) {
    const firmware = await this.firmwareService.getLatestFirmwareOrThrow();
    const firmwarePath = this.firmwareService.resolveFirmwareFilePath(firmware);
    await this.firmwareService.assertFirmwareFileExists(firmwarePath);

    const sanitizedName = firmware.originalFileName.replace(/"/g, '');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizedName}"`
    );
    res.setHeader('X-Firmware-Version', firmware.version);
    res.setHeader('X-Firmware-Checksum', firmware.checksum);
    res.setHeader('Content-Length', firmware.size.toString());

    return res.sendFile(firmwarePath);
  }
}
