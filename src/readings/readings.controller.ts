import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { ReadingsService } from './readings.service';
import { GetReadingsQueryDto } from './dto/get-readings-query.dto';
import { AuthGuard } from '../guards/auth/auth.guard';

/**
 * ReadingsController
 *
 * Exposes time-series sensor reading history stored from the MQTT pipeline.
 * All endpoints require a valid user JWT.
 */
@ApiTags('Sensor Readings')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('readings')
export class ReadingsController {
  constructor(private readonly readingsService: ReadingsService) {}

  /**
   * Get paginated historical readings for a specific flow node.
   *
   * @route GET /readings/:flowId/:nodeId
   * @query from  — ISO 8601 start timestamp (optional)
   * @query to    — ISO 8601 end timestamp (optional)
   * @query limit — max results, 1–2000 (default 500)
   */
  @Get(':flowId/:nodeId')
  @ApiOperation({
    summary: 'Get historical sensor readings for a node',
    description:
      'Returns time-series sensor readings ordered oldest-first. ' +
      'Supports optional time-range filtering and result limiting.',
  })
  @ApiParam({ name: 'flowId', description: 'Flow ID' })
  @ApiParam({ name: 'nodeId', description: 'Input node ID' })
  @ApiResponse({ status: 200, description: 'Array of reading documents' })
  async getReadings(
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
    @Query() query: GetReadingsQueryDto
  ) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    if (from && to && from > to) {
      throw new BadRequestException('"from" must be before "to"');
    }

    const data = await this.readingsService.getReadings(
      flowId,
      nodeId,
      from,
      to,
      query.limit
    );

    return {
      flowId,
      nodeId,
      count: data.length,
      data,
    };
  }

  /**
   * Get the most recent reading for a node.
   *
   * @route GET /readings/:flowId/:nodeId/latest
   */
  @Get(':flowId/:nodeId/latest')
  @ApiOperation({
    summary: 'Get the latest sensor reading for a node',
    description:
      'Returns the single most recent reading — useful for live dashboard widgets.',
  })
  @ApiParam({ name: 'flowId', description: 'Flow ID' })
  @ApiParam({ name: 'nodeId', description: 'Input node ID' })
  @ApiResponse({ status: 200, description: 'Most recent reading or null' })
  async getLatestReading(
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string
  ) {
    const reading = await this.readingsService.getLatestReading(flowId, nodeId);
    return { flowId, nodeId, reading };
  }
}
