import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './company.entity';
import { SearchLog } from './search-log.entity';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { IngestionService } from './ingestion.service';
import { SourceImportService } from './source-import.service';
import { SearchModule } from '../search/search.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Company, SearchLog]), SearchModule, UsersModule],
  providers: [CompaniesService, IngestionService, SourceImportService],
  controllers: [CompaniesController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
