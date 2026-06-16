import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth/guards';
import { UsersService } from '../users/users.service';
import { CompaniesService } from '../companies/companies.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private users: UsersService,
    private companies: CompaniesService,
  ) {}

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
