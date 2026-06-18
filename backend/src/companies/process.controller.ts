import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { ProcessService } from './process.service';
import { logBuffer } from '../common/log-buffer';

@UseGuards(JwtAuthGuard)
@Controller('process')
export class ProcessController {
  constructor(private process: ProcessService) {}

  @Get('status')
  status() {
    return this.process.getStatus();
  }

  @Get('logs')
  logs(@Query('page') page = '0', @Query('size') size = '50', @Query('filter') filter?: string) {
    return logBuffer.page(parseInt(page, 10) || 0, Math.min(parseInt(size, 10) || 50, 200), filter);
  }

  @Post('start')
  start() {
    this.process.orchestrate().catch(() => {});
    return { started: true };
  }
}
