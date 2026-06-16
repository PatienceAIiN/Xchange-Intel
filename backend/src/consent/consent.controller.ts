import { Body, Controller, Post, Req } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { ConsentDto } from './dto/consent.dto';

@Controller('consent')
export class ConsentController {
  constructor(private consent: ConsentService) {}

  @Post()
  async record(@Body() dto: ConsentDto, @Req() request: any) {
    const event = await this.consent.record(dto, request);
    return {
      id: event.id,
      decision: event.decision,
      policyVersion: event.policyVersion,
      createdAt: event.createdAt,
    };
  }
}
