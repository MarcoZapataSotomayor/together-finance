import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service.js';

const config = new ConfigService({
  DATABASE_URL: 'postgresql://database.example.invalid/finance',
});
const clients: PrismaService[] = [];
const createService = () => {
  const service = new PrismaService(config);
  clients.push(service);
  return service;
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(
    clients.splice(0).map((client) => client.$disconnect()),
  );
});

describe('Prisma service lifecycle', () => {
  it('registers one reusable instance per Nest application context', async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, { provide: ConfigService, useValue: config }],
    }).compile();
    const service = module.get(PrismaService);
    clients.push(service);
    expect(module.get(PrismaService)).toBe(service);
    const connect = vi.spyOn(service, '$connect').mockResolvedValue();
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();
    await module.init();
    await module.close();
    expect(connect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('reports connection failures without including driver details', async () => {
    const service = createService();
    vi.spyOn(service, '$connect').mockRejectedValue(
      new Error('Private driver details'),
    );
    await expect(service.onModuleInit()).rejects.toThrow(
      'Verify database configuration',
    );
    await expect(service.onModuleInit()).rejects.not.toThrow(
      'Private driver details',
    );
  });
});
