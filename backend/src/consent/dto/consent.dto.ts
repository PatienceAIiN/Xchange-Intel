import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ConsentDecision } from '../consent-event.entity';

export class ConsentDto {
  @IsIn(['accepted', 'denied'])
  decision: ConsentDecision;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  policyVersion?: string;
}
