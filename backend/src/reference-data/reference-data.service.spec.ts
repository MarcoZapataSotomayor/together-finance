import { beforeEach, describe, expect, it } from 'vitest';
import { ReferenceDataService } from './reference-data.service.js';
import { PaginationDto } from '../finance/api-validation.js';
import { FinanceStore, ids } from '../../test/finance-store.js';

describe('expense reference data', () => {
  let store: FinanceStore;
  let service: ReferenceDataService;
  beforeEach(() => {
    store = new FinanceStore();
    service = new ReferenceDataService(store.prisma());
  });

  it('creates financial people, categories and typed methods with explicit optional owners', async () => {
    const person = await service.createPerson({
      name: 'Example relative',
      notes: 'Synthetic',
    });
    expect(person.isActive).toBe(true);
    expect(
      (await service.createCategory({ name: 'Example groceries' })).description,
    ).toBeNull();
    const method = await service.createPaymentMethod({
      name: 'Example debit card',
      type: 'DEBIT_CARD',
      ownerPersonId: person.id,
    });
    expect(method.ownerPersonId).toBe(person.id);
    expect(method.type).toBe('DEBIT_CARD');
    expect(
      (
        await service.createPaymentMethod({
          name: 'Example cash',
          type: 'CASH',
        })
      ).ownerPersonId,
    ).toBeNull();
  });

  it('rejects trimmed case-insensitive duplicate names, including inactive records', async () => {
    store.people[0].isActive = false;
    await expect(service.createPerson({ name: ' ANTONELLA ' })).rejects.toThrow(
      'already exists',
    );
    await expect(
      service.createCategory({ name: ' EXAMPLE CATEGORY ' }),
    ).rejects.toThrow('already exists');
    await expect(
      service.createPaymentMethod({ name: 'example card', type: 'CASH' }),
    ).rejects.toThrow('already exists');
  });

  it('rejects unknown/inactive owners without persisting a method', async () => {
    store.people[0].isActive = false;
    await expect(
      service.createPaymentMethod({
        name: 'Example new method',
        type: 'CREDIT_CARD',
        ownerPersonId: ids.antonella,
      }),
    ).rejects.toThrow('active');
    expect(store.methods).toHaveLength(1);
  });

  it('paginates active selection data and does not list inactive records', async () => {
    store.people[0].isActive = false;
    const people = await service.listPeople(
      Object.assign(new PaginationDto(), { page: 2, pageSize: 1 }),
    );
    expect(people.total).toBe(2);
    expect(people.data).toHaveLength(1);
    expect(people.data.every((row) => row.isActive)).toBe(true);
    expect((await service.listCategories(new PaginationDto())).total).toBe(1);
    expect((await service.listPaymentMethods(new PaginationDto())).total).toBe(
      1,
    );
  });

  it('rolls back and retries a serializable duplicate-name race without making two rows', async () => {
    store.conflictBeforeCommit = 1;
    await service.createPerson({ name: 'Example new person' });
    expect(
      store.people.filter((row) => row.name === 'Example new person'),
    ).toHaveLength(1);
    expect(store.client.$transaction).toHaveBeenCalledTimes(2);
    expect(
      store.transactionOptions.every(
        (option) => (option as any).isolationLevel === 'Serializable',
      ),
    ).toBe(true);
  });
});
