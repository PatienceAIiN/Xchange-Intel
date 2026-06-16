import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [UsersModule, CompaniesModule],
  controllers: [AdminController],
})
export class AdminModule {}
