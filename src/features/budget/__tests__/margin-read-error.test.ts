import { supabase } from '../../../infrastructure/supabase/client';
import { readDashboard } from '../../dashboard/dashboard-data';
import { period, profile, snapshot } from '../../dashboard/__tests__/fixtures';
import { readSafeToSpend } from '../safe-to-spend-data';
import {
  MarginReadError,
  marginRpcError,
  safeToSpendErrorMessage,
} from '../margin-read-error';

jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
beforeEach(() => jest.clearAllMocks());

const privateDetails = 'synthetic-private-amount-description-and-token';
const readers = [
  ['dashboard', () => readDashboard(profile.id, period.starts_on)],
  ['budget margin', () => readSafeToSpend(period)],
] as const;

describe.each(readers)('%s read boundary', (_label, read) => {
  test.each([
    [0, '', 'TRANSPORT'],
    [0, '23514', 'TRANSPORT'],
    [500, 'PGRST202', 'RPC'],
    [500, privateDetails, 'RPC'],
    [400, '23514', 'INCOMPATIBLE_DATA'],
    [400, '22003', 'OUT_OF_RANGE'],
    [403, '42501', 'ACCESS'],
  ] as const)(
    'classifies status %s / code %s without retaining raw provider data',
    async (status, code, reason) => {
      jest.mocked(supabase.rpc).mockResolvedValue({
        data: { privateDetails },
        status,
        error: {
          code,
          message: privateDetails,
          details: privateDetails,
          hint: privateDetails,
        },
      } as never);
      const failure: unknown = await read().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(MarginReadError);
      expect(failure).toMatchObject({ reason });
      expect(JSON.stringify(failure)).not.toContain(privateDetails);
      expect(failure).not.toHaveProperty('cause');
      expect(safeToSpendErrorMessage(failure)).not.toContain(privateDetails);
    },
  );
  test('rejected request is not blamed on invalid financial data', async () => {
    jest.mocked(supabase.rpc).mockRejectedValue(new Error(privateDetails));
    await expect(read()).rejects.toEqual(new MarginReadError('TRANSPORT'));
  });
  test('a successful response with invalid contract is distinct from transport/RPC failure', async () => {
    jest.mocked(supabase.rpc).mockResolvedValue({
      data: { privateDetails },
      status: 200,
      error: null,
    } as never);
    const error: unknown = await read().catch((failure: unknown) => failure);
    expect(error).toEqual(new MarginReadError('INVALID_CONTRACT'));
    expect(safeToSpendErrorMessage(error)).toContain('MARGEN-RESPUESTA');
    expect(safeToSpendErrorMessage(error)).not.toMatch(
      /migraci|desactualizad|synthetic-private/,
    );
  });
});

test('inconsistent complete response is also rejected, never downgraded to zero/legacy', async () => {
  const data = snapshot();
  data.received_income_minor++;
  jest.mocked(supabase.rpc).mockResolvedValue({
    data,
    status: 200,
    error: null,
  } as never);
  await expect(readDashboard(profile.id, period.starts_on)).rejects.toEqual(
    new MarginReadError('INVALID_CONTRACT'),
  );
  delete (data as { snapshot_version?: number }).snapshot_version;
  jest.mocked(supabase.rpc).mockResolvedValue({
    data,
    status: 200,
    error: null,
  } as never);
  await expect(readDashboard(profile.id, period.starts_on)).rejects.toEqual(
    new MarginReadError('INVALID_CONTRACT'),
  );
});

test('only known codes affect guidance; free text never infers a cause or reaches logs', async () => {
  const logs = [
    jest.spyOn(console, 'log'),
    jest.spyOn(console, 'warn'),
    jest.spyOn(console, 'error'),
  ];
  try {
    const error = {
      code: 'unexpected',
      message: 'offline missing migration unauthorized',
      details: privateDetails,
    };
    expect(marginRpcError(error)).toEqual(new MarginReadError('RPC'));
    expect(safeToSpendErrorMessage(error)).toContain('MARGEN-SERVICIO');
    expect(safeToSpendErrorMessage(error)).not.toMatch(
      /offline|migration|unauthorized/,
    );
    jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error } as never);
    await expect(readSafeToSpend(period)).rejects.toEqual(
      new MarginReadError('RPC'),
    );
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});
