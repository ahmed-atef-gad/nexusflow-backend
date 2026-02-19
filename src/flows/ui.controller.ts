import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { UiService } from './ui.service';
import { UiPayload } from './types/flow.types';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiCookieAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { Ui } from './schemas/ui.schema';

@ApiTags('UI (User Interface)')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard)
@Controller('ui')
export class UiController {
  constructor(private readonly uiService: UiService) {}

  @ApiOperation({ summary: 'Get Ui by Flow ID' })
  @ApiParam({ name: 'flowId' })
  @ApiResponse({ status: 200, type: Ui })
  @Get('flow/:flowId')
  findByFlowId(@Param('flowId') flowId: string) {
    return this.uiService.findByFlowId(flowId);
  }
}
