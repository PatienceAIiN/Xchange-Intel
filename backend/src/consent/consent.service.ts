import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsentEvent } from './consent-event.entity';
import { ConsentDto } from './dto/consent.dto';

@Injectable()
export class ConsentService {
  constructor(@InjectRepository(ConsentEvent) private repo: Repository<ConsentEvent>) {}

  record(dto: ConsentDto, request: any) {
    const forwarded = request.headers?.['x-forwarded-for'];
    const ipAddress = Array.isArray(forwarded)
      ? forwarded[0]
      : (forwarded || request.ip || request.socket?.remoteAddress || '').split(',')[0].trim();

    return this.repo.save(
      this.repo.create({
        decision: dto.decision,
        policyVersion: dto.policyVersion || 'dpdp_gdpr_banner_v1',
        sessionId: dto.sessionId || null,
        userAgent: request.headers?.['user-agent'] || null,
        ipAddress: ipAddress || null,
      }),
    );
  }
}
