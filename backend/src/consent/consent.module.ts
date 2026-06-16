import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentController } from './consent.controller';
import { ConsentEvent } from './consent-event.entity';
import { ConsentService } from './consent.service';

@Module({
  imports: [TypeOrmModule.forFeature([ConsentEvent])],
  controllers: [ConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
