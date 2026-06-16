import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type UserRole = 'user' | 'admin';
export type PlanTier = 'free' | 'pro' | 'enterprise';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column()
  passwordHash: string;

  @Column({ default: '' })
  fullName: string;

  @Column({ type: 'varchar', default: 'user' })
  role: UserRole;

  @Column({ type: 'varchar', default: 'free' })
  plan: PlanTier;

  @Column({ default: 0 })
  searchCount: number;

  @Column({ default: true })
  isActive: boolean;

  // DPDP/GDPR: explicit consent flag + timestamp
  @Column({ default: false })
  consentGiven: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  consentAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
