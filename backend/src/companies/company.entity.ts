import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  name: string;

  // normalised lowercase key for cache lookups
  @Index({ unique: true })
  @Column()
  slug: string;

  @Index()
  @Column({ nullable: true })
  cin: string;

  @Column({ nullable: true })
  llpin: string;

  @Column({ nullable: true })
  website: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  emails: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  phones: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  founders: string[];

  @Column({ type: 'text', default: '' })
  address: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  socialLinks: Record<string, string>;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'text', default: '' })
  aiOverview: string;

  // which sources contributed: startup_india, mca/datagov, google, ai
  @Column({ type: 'jsonb', default: () => "'[]'" })
  sources: string[];

  // full raw merged payload for auditing / re-export
  @Column({ type: 'jsonb', default: () => "'{}'" })
  raw: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  startupIndiaRecognised: boolean;

  @Column({ nullable: true })
  dpiitNumber: string;

  @Column({ default: '' })
  industry: string;

  @Column({ default: '' })
  stage: string;

  // MCA company status (Active / Strike Off / etc.)
  @Column({ default: '' })
  status: string;

  @Column({ default: '' })
  city: string;

  @Column({ default: '' })
  state: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  directors: string[];

  @Column({ default: '' })
  authorizedCapital: string;

  @Column({ default: '' })
  paidUpCapital: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
