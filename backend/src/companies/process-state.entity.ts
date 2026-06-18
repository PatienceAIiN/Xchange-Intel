import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/** Tiny key-value store so import progress survives redeploys (resume, never reset). */
@Entity('process_state')
export class ProcessState {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  value: Record<string, any>;

  @UpdateDateColumn()
  updatedAt: Date;
}
