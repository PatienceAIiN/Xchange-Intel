import { Controller, Get, Post, Body, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { ExportService } from './export.service';
import { CompaniesService } from '../companies/companies.service';

@UseGuards(JwtAuthGuard)
@Controller('export')
export class ExportController {
  constructor(
    private exporter: ExportService,
    private companies: CompaniesService,
  ) {}

  // bulk export of multiple selected companies (each row includes company + product/industry)
  @Post('batch')
  async batch(
    @Body() body: { ids?: string[]; all?: boolean; format?: string },
    @Res() res: Response,
  ) {
    const list = body.all
      ? await this.companies.list(undefined, 100000)
      : await this.companies.findByIds(body.ids || []);
    const format = body.format || 'csv';
    const map: Record<string, () => any> = {
      json: () => [this.exporter.jsonMany(list), 'application/json', 'json'],
      csv: () => [this.exporter.csvMany(list), 'text/csv', 'csv'],
      excel: async () => [
        await this.exporter.excelMany(list),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xlsx',
      ],
      pdf: async () => [await this.exporter.pdfMany(list), 'application/pdf', 'pdf'],
    };
    const [buf, mime, ext] = await (map[format] || map.csv)();
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="xchange-intel-${list.length}-companies.${ext}"`);
    res.send(buf);
  }

  @Get(':id')
  async export(
    @Param('id') id: string,
    @Query('format') format = 'json',
    @Res() res: Response,
  ) {
    const c = await this.companies.findOne(id);
    const base = (c.slug || 'company').slice(0, 40);
    const map: Record<string, () => any> = {
      json: () => [this.exporter.json(c), 'application/json', 'json'],
      csv: () => [this.exporter.csv(c), 'text/csv', 'csv'],
      excel: async () => [
        await this.exporter.excel(c),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xlsx',
      ],
      pdf: async () => [await this.exporter.pdf(c), 'application/pdf', 'pdf'],
    };
    const fn = map[format] || map.json;
    const [buf, mime, ext] = await fn();
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${base}.${ext}"`);
    res.send(buf);
  }
}
