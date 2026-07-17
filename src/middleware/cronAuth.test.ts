import { Request, Response } from 'express';
import { config } from '../config';
import { requireCronSecret } from './cronAuth';

function mockReqRes(header?: string) {
  const req = { header: (name: string) => (name.toLowerCase() === 'x-cron-secret' ? header : undefined) } as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

describe('requireCronSecret', () => {
  it('calls next() when the header matches the configured secret', () => {
    const { req, res, next } = mockReqRes(config.cronSecret);
    requireCronSecret(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('401s when the header is missing', () => {
    const { req, res, next } = mockReqRes(undefined);
    requireCronSecret(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('401s when the header does not match', () => {
    const { req, res, next } = mockReqRes('wrong-secret');
    requireCronSecret(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
