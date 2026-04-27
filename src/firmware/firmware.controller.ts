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
import { RateLimit, RateLimiterGuard } from 'nestjs-rate-limiter';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { basename, extname } from 'path';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import type { Response } from 'express';
import { AuthGuard } from '../guards/auth/auth.guard';
import { RolesGuard } from '../guards/auth/roles.guard';
import { DeviceAuthGuard } from '../guards/device-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../users/enums/role.enum';
import { UploadFirmwareDto } from './dto/upload-firmware.dto';
import { FirmwareService } from './firmware.service';
import { FIRMWARE_UPLOAD_DIR } from './firmware.constants';

@ApiTags('Firmware')
@Controller('firmware')
export class FirmwareController {
  constructor(private readonly firmwareService: FirmwareService) {}

  @ApiOperation({
    summary: 'Upload firmware binary (.bin)',
    description:
      'Uploads a new firmware binary and marks it as the latest active release. Admin only: accessible by Admin or Owner.',
  })
  @ApiCookieAuth('jwt')
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
        destination: (_, __, callback) => {
          if (!existsSync(FIRMWARE_UPLOAD_DIR)) {
            mkdirSync(FIRMWARE_UPLOAD_DIR, { recursive: true });
          }
          callback(null, FIRMWARE_UPLOAD_DIR);
        },
        filename: (_, file, callback) => {
          const extension = extname(file.originalname).toLowerCase();
          const baseName = basename(file.originalname, extension).replace(
            /[^a-zA-Z0-9_-]/g,
            '_'
          );
          const uniqueName = `${Date.now()}-${baseName}${extension}`;
          callback(null, uniqueName);
        },
      }),
      fileFilter: (_, file, callback) => {
        const extension = extname(file.originalname).toLowerCase();
        if (extension !== '.bin') {
          return callback(
            new BadRequestException('Only .bin firmware files are allowed'),
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
    @UploadedFile() file: any,
    @Body() body: UploadFirmwareDto,
    @Req() req
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
  @ApiCookieAuth('jwt')
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
    @Req() req
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
  @UseGuards(RateLimiterGuard)
  @RateLimit({
    keyPrefix: 'firmware-download',
    points: 3,
    duration: 60 * 60,
    errorMessage:
      'You can only download firmware 3 times per hour. Please try again later.',
  })
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
