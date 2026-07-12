import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import { createReadStream, constants as fsConstants } from 'fs';
import { access, unlink } from 'fs/promises';
import { basename, extname, resolve, sep } from 'path';
import { Firmware, FirmwareDocument } from './schemas/firmware.schema';
import { FIRMWARE_UPLOAD_DIR } from './firmware.constants';

export type UploadedFirmwareFile = {
  path: string;
  filename: string;
  originalname: string;
  size: number;
};

@Injectable()
export class FirmwareService {
  constructor(
    @InjectModel(Firmware.name)
    private readonly firmwareModel: Model<FirmwareDocument>
  ) {}

  async uploadFirmware(
    file: UploadedFirmwareFile,
    version: string,
    uploadedBy?: string
  ) {
    if (!file?.path || !file?.filename || !file?.originalname) {
      throw new BadRequestException('Invalid firmware file');
    }

    const normalizedVersion = version?.trim();
    if (!normalizedVersion) {
      await this.removeFileIfExists(file.path);
      throw new BadRequestException('Firmware version is required');
    }

    const existingVersion = await this.firmwareModel.findOne({
      version: normalizedVersion,
    });
    if (existingVersion) {
      await this.removeFileIfExists(file.path);
      throw new BadRequestException(
        `Firmware version ${normalizedVersion} already exists`
      );
    }

    const checksum = await this.calculateSha256(file.path);

    try {
      const payload: Partial<Firmware> = {
        version: normalizedVersion,
        originalFileName: file.originalname,
        storedFileName: file.filename,
        checksum,
        size: file.size,
        isActive: true,
      };

      if (uploadedBy && Types.ObjectId.isValid(uploadedBy)) {
        payload.uploadedBy = new Types.ObjectId(uploadedBy);
      }

      const createdFirmware = await this.firmwareModel.create(payload);

      await this.firmwareModel.updateMany(
        { _id: { $ne: createdFirmware._id }, isActive: true },
        { $set: { isActive: false } }
      );

      return createdFirmware;
    } catch (error) {
      await this.removeFileIfExists(file.path);
      if ((error as { code?: number })?.code === 11000) {
        throw new BadRequestException(
          `Firmware version ${normalizedVersion} already exists`
        );
      }
      throw error;
    }
  }

  async checkForUpdate(
    currentVersion: string | undefined,
    request: {
      headers: Record<string, string | string[] | undefined>;
      protocol?: string;
      get?: (headerName: string) => string | undefined;
    }
  ) {
    const latestFirmware = await this.getLatestFirmware();

    if (!latestFirmware) {
      return {
        updateAvailable: false,
        currentVersion: currentVersion?.trim() || null,
        latestVersion: null,
        checksum: null,
        size: null,
        downloadUrl: null,
      };
    }

    const normalizedCurrent = currentVersion?.trim() || null;
    const updateAvailable =
      !normalizedCurrent ||
      this.compareVersions(latestFirmware.version, normalizedCurrent) > 0;

    return {
      updateAvailable,
      currentVersion: normalizedCurrent,
      latestVersion: latestFirmware.version,
      checksum: latestFirmware.checksum,
      size: latestFirmware.size,
      downloadUrl: updateAvailable ? this.buildDownloadUrl(request) : null,
    };
  }

  async getLatestFirmwareOrThrow(): Promise<FirmwareDocument> {
    const latestFirmware = await this.getLatestFirmware();
    if (!latestFirmware) {
      throw new NotFoundException('No firmware has been uploaded yet');
    }

    return latestFirmware;
  }

  async getFirmwareHistory(params: { page?: number; limit?: number }): Promise<{
    data: FirmwareDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const parsedPage = Number(params.page);
    const parsedLimit = Number(params.limit);

    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.firmwareModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.firmwareModel.countDocuments().exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: total > 0 ? Math.ceil(total / limit) : 1,
    };
  }

  async deleteFirmware(firmwareId: string) {
    if (!Types.ObjectId.isValid(firmwareId)) {
      throw new BadRequestException('Invalid firmware ID');
    }

    const firmware = await this.firmwareModel.findById(firmwareId).exec();
    if (!firmware) {
      throw new NotFoundException(`Firmware with ID ${firmwareId} not found`);
    }

    let firmwarePath: string | null = null;
    try {
      firmwarePath = this.resolveFirmwareFilePath(firmware);
    } catch {
      firmwarePath = null;
    }

    await this.firmwareModel.deleteOne({ _id: firmware._id });

    if (firmwarePath) {
      await this.removeFileIfExists(firmwarePath);
    }

    if (firmware.isActive) {
      await this.promoteLatestFirmwareAsActive();
    }

    return {
      message: 'Firmware deleted successfully',
      deletedId: firmwareId,
    };
  }

  async assertFirmwareFileExists(filePath: string): Promise<void> {
    try {
      await access(filePath, fsConstants.F_OK);
    } catch {
      throw new NotFoundException('Firmware binary file not found on disk');
    }
  }

  resolveFirmwareFilePath(firmware: FirmwareDocument): string {
    const fileNameFromDb = firmware.storedFileName;

    if (!fileNameFromDb) {
      throw new NotFoundException('Firmware file reference is missing');
    }

    const safeFileName = basename(fileNameFromDb);
    if (safeFileName !== fileNameFromDb) {
      throw new NotFoundException('Invalid firmware file reference');
    }

    if (extname(safeFileName).toLowerCase() !== '.bin') {
      throw new NotFoundException('Invalid firmware file extension');
    }

    const absolutePath = resolve(FIRMWARE_UPLOAD_DIR, safeFileName);
    this.assertPathInsideFirmwareDirectory(absolutePath);

    return absolutePath;
  }

  private async getLatestFirmware(): Promise<FirmwareDocument | null> {
    const activeFirmware = await this.firmwareModel
      .findOne({ isActive: true })
      .sort({ createdAt: -1 })
      .exec();

    if (activeFirmware) {
      return activeFirmware;
    }

    return this.firmwareModel.findOne().sort({ createdAt: -1 }).exec();
  }

  private buildDownloadUrl(request: {
    headers: Record<string, string | string[] | undefined>;
    protocol?: string;
    get?: (headerName: string) => string | undefined;
  }): string {
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol: string | undefined =
      typeof forwardedProto === 'string'
        ? forwardedProto.split(',')[0]
        : request.protocol;
    const hostValue = request.get?.('host') ?? request.headers.host;
    const host = typeof hostValue === 'string' ? hostValue : undefined;

    if (!protocol || !host) {
      return '/firmware/device/download';
    }

    return `${protocol}://${host}/firmware/device/download`;
  }

  private compareVersions(
    latestVersion: string,
    currentVersion: string
  ): number {
    const latestParts = this.extractVersionParts(latestVersion);
    const currentParts = this.extractVersionParts(currentVersion);
    const maxLength = Math.max(latestParts.length, currentParts.length);

    for (let index = 0; index < maxLength; index++) {
      const latestValue = latestParts[index] ?? 0;
      const currentValue = currentParts[index] ?? 0;

      if (latestValue > currentValue) {
        return 1;
      }
      if (latestValue < currentValue) {
        return -1;
      }
    }

    return 0;
  }

  private extractVersionParts(version: string): number[] {
    const normalizedVersion = version.trim().replace(/^v/i, '');
    return normalizedVersion.split('.').map((segment) => {
      const numericPrefix = segment.match(/^\d+/);
      return numericPrefix ? Number.parseInt(numericPrefix[0], 10) : 0;
    });
  }

  private async calculateSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private async removeFileIfExists(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // No-op if file does not exist.
    }
  }

  private async promoteLatestFirmwareAsActive(): Promise<void> {
    const latestRemaining = await this.firmwareModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec();

    if (!latestRemaining) {
      return;
    }

    await this.firmwareModel.updateMany(
      { _id: { $ne: latestRemaining._id }, isActive: true },
      { $set: { isActive: false } }
    );

    if (!latestRemaining.isActive) {
      latestRemaining.isActive = true;
      await latestRemaining.save();
    }
  }

  private assertPathInsideFirmwareDirectory(filePath: string): void {
    const rootPath = resolve(FIRMWARE_UPLOAD_DIR);
    const rootPathWithSeparator = rootPath.endsWith(sep)
      ? rootPath
      : `${rootPath}${sep}`;
    const normalizedTargetPath = resolve(filePath);

    if (
      !normalizedTargetPath
        .toLowerCase()
        .startsWith(rootPathWithSeparator.toLowerCase())
    ) {
      throw new NotFoundException('Invalid firmware file path');
    }
  }
}
