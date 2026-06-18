import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './company.entity';
import { SearchLog } from './search-log.entity';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { IngestionService } from './ingestion.service';
import { SourceImportService } from './source-import.service';
import { McaImportService } from './mca-import.service';
import { StartupImportService } from './startup-import.service';
import { ContactFillService } from './contact-fill.service';
import { BackupService } from './backup.service';
import { ProcessService } from './process.service';
import { ProcessController } from './process.controller';
import { EmailService } from '../common/email.service';
import { SearchModule } from '../search/search.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Company, SearchLog]), SearchModule, UsersModule],
  providers: [
    CompaniesService, IngestionService, SourceImportService, McaImportService,
    StartupImportService, ContactFillService, BackupService, ProcessService, EmailService,
  ],
  controllers: [CompaniesController, ProcessController],
  exports: [CompaniesService, McaImportService, StartupImportService, ContactFillService, ProcessService],
})
export class CompaniesModule {}
