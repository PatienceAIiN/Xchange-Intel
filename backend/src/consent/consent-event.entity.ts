import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ConsentDecision = 'accepted' | 'denied';

@Entity('consent_events')
export class ConsentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  decision: ConsentDecision;

  @Column({ default: 'dpdp_gdpr_banner_v1' })
  policyVersion: string;

  @Column({ nullable: true })
  sessionId: string;

  @Column({ nullable: true })
  userAgent: string;

  @Column({ nullable: true })
  ipAddress: string;

  @CreateDateColumn()
  createdAt: Date;
}
