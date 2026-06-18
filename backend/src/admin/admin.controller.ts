import { Controller, Get, Post, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth/guards';
import { UsersService } from '../users/users.service';
import { CompaniesService } from '../companies/companies.service';
import { McaImportService } from '../companies/mca-import.service';
import { ContactFillService } from '../companies/contact-fill.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private users: UsersService,
    private companies: CompaniesService,
    private mcaImport: McaImportService,
    private contactFill: ContactFillService,
  ) {}

  // start the live contact-filler (runs in background; watch ETA/filled data in server logs)
  @Post('fill-contacts')
  startFill() {
    this.contactFill.run(); // fire-and-forget
    return { started: true };
  }

  @Get('fill-contacts/status')
  fillStatus() {
    return this.contactFill.getStats();
  }

  // start a bulk MCA import (runs in background; watch ETA in server logs)
  @Post('import-mca')
  startMcaImport(@Query('target') target?: string, @Query('offset') offset?: string) {
    const t = Math.min(parseInt(target || '50000', 10) || 50000, 500000);
    this.mcaImport.run(t, parseInt(offset || '0', 10) || 0); // fire-and-forget
    return { started: true, target: t };
  }

  @Get('import-mca/status')
  mcaImportStatus() {
    return this.mcaImport.getStats();
  }

  @Get('stats')
  async stats() {
    return {
      users: await this.users.count(),
      companies: await this.companies.countCompanies(),
      searches: await this.companies.countSearches(),
    };
  }

  @Get('users')
  async listUsers() {
    return (await this.users.findAll()).map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      plan: u.plan,
      searchCount: u.searchCount,
      isActive: u.isActive,
      createdAt: u.createdAt,
    }));
  }

  @Patch('users/:id/toggle')
  async toggle(@Param('id') id: string) {
    const u = await this.users.findById(id);
    u.isActive = !u.isActive;
    await this.users.save(u);
    return { id: u.id, isActive: u.isActive };
  }
}
