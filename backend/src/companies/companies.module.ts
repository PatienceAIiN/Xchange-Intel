import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './company.entity';
import { SearchLog } from './search-log.entity';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { IngestionService } from './ingestion.service';
import { SourceImportService } from './source-import.service';
import { McaImportService } from './mca-import.service';
import { ContactFillService } from './contact-fill.service';
import { ProcessService } from './process.service';
import { ProcessController } from './process.controller';
import { EmailService } from '../common/email.service';
import { SearchModule } from '../search/search.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Company, SearchLog]), SearchModule, UsersModule],
  providers: [
    CompaniesService, IngestionService, SourceImportService, McaImportService,
    ContactFillService, ProcessService, EmailService,
  ],
  controllers: [CompaniesController, ProcessController],
  exports: [CompaniesService, McaImportService, ContactFillService],
})
export class CompaniesModule {}
