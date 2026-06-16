import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards';
import { CompaniesService } from './companies.service';
import { IngestionService } from './ingestion.service';
import { SearchDto } from './dto/search.dto';

@UseGuards(JwtAuthGuard)
@Controller('companies')
export class CompaniesController {
  constructor(
    private companies: CompaniesService,
    private ingestion: IngestionService,
  ) {}

  // live auto-ingestion stats (total companies + newly added each interval)
  @Get('ingestion/stats')
  ingestionStats() {
    return this.ingestion.getStats();
  }

  // scraper/search endpoints get their own tighter limit
  @Throttle({ default: { limit: parseInt(process.env.RATE_LIMIT_SCRAPER || '20', 10), ttl: 3600000 } })
  @Post('search')
  search(@Body() dto: SearchDto, @Req() req: any) {
    return this.companies.searchAndStore(dto.query, req.user.id, dto.refresh);
  }

  @Get()
  list(@Query('q') q?: string) {
    return this.companies.list(q);
  }

  @Get('recent')
  recent(@Req() req: any) {
    return this.companies.recentSearches(req.user.id);
  }

  @Post('delete/batch')
  deleteBatch(@Body() body: { ids: string[] }) {
    return this.companies.deleteBatch(body.ids || []);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.companies.findOne(id);
  }

  // lazy enrichment: fetch MCA financials + contacts for a seeded company on demand
  @Throttle({ default: { limit: parseInt(process.env.RATE_LIMIT_SCRAPER || '20', 10), ttl: 3600000 } })
  @Post(':id/enrich')
  enrich(@Param('id') id: string) {
    return this.companies.enrich(id);
  }

  @Throttle({ default: { limit: parseInt(process.env.RATE_LIMIT_DEFAULT || '100', 10), ttl: 60000 } })
  @Post(':id/ask')
  ask(@Param('id') id: string, @Body() body: { question: string }) {
    return this.companies.ask(id, (body?.question || '').slice(0, 500));
  }
}
