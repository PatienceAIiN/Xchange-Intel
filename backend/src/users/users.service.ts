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
}
