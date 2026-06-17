import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<User>) {
    const user = this.repo.create({ ...data, email: data.email.toLowerCase() });
    return this.repo.save(user);
  }

  async incrementSearch(id: string) {
    await this.repo.increment({ id }, 'searchCount', 1);
  }

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  save(user: User) {
    return this.repo.save(user);
  }

  count() {
    return this.repo.count();
  }

  /** Import users from the source DB into our schema (deduped by email). */
  async bulkImportExternal(rows: any[]): Promise<{ added: number; skipped: number }> {
    if (!rows?.length) return { added: 0, skipped: 0 };
    const existing = new Set(
      (await this.repo.find({ select: ['email'] })).map((u) => u.email.toLowerCase()),
    );
    const toInsert: Partial<User>[] = [];
    let skipped = 0;
    for (const r of rows) {
      const email = (r.email || '').toLowerCase().trim();
      if (!email || !r.hashed_password || existing.has(email)) { skipped++; continue; }
      existing.add(email);
      toInsert.push({
        email,
        passwordHash: r.hashed_password, // bcrypt $2b$ — compatible with bcryptjs
        fullName: r.full_name || '',
        role: r.is_admin ? 'admin' : 'user',
        plan: 'free',
        isActive: r.is_active ?? true,
        consentGiven: true,
        consentAt: r.created_at ? new Date(r.created_at) : new Date(),
      });
    }
    let added = 0;
    for (let i = 0; i < toInsert.length; i += 100) {
      await this.repo.save(toInsert.slice(i, i + 100).map((u) => this.repo.create(u)));
      added += Math.min(100, toInsert.length - i);
    }
    return { added, skipped };
  }
}
